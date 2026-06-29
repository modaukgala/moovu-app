import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";

const VALID_REASONS = [
  "Customer asked to cancel",
  "Could not reach pickup",
  "Unsafe pickup situation",
  "Vehicle issue",
  "Emergency",
  "Other",
];

function isMissingCancellationColumn(error: { message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return message.includes("cancellation_") || message.includes("cancelled_at");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error.";
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 401 });
    }

    const body = await req.json();
    const tripId = String(body?.tripId ?? "").trim();
    const reason = String(body?.reason ?? "").trim();

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    }

    if (!VALID_REASONS.includes(reason)) {
      return NextResponse.json(
        { ok: false, error: "Please select a valid cancellation reason." },
        { status: 400 }
      );
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mappingError || !mapping?.driver_id) {
      return NextResponse.json(
        { ok: false, error: "Driver account not linked." },
        { status: 400 }
      );
    }

    const driverId = mapping.driver_id;

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,status,driver_id")
      .eq("id", tripId)
      .maybeSingle();

    if (tripError) {
      return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
    }

    if (!trip) {
      return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    }

    if (trip.driver_id !== driverId) {
      return NextResponse.json(
        { ok: false, error: "This trip is not assigned to you." },
        { status: 403 }
      );
    }

    if (!["assigned", "arrived"].includes(String(trip.status))) {
      return NextResponse.json(
        { ok: false, error: "Only accepted trips that have not started can be cancelled here." },
        { status: 400 }
      );
    }

    const cancelledAt = new Date().toISOString();
    let updateResult = await supabaseAdmin
      .from("trips")
      .update({
        status: "cancelled",
        cancel_reason: reason,
        cancellation_reason: reason,
        cancellation_type: "driver_cancelled",
        cancelled_by: "driver",
        cancelled_at: cancelledAt,
        cancellation_fee_amount: 0,
        cancellation_driver_amount: 0,
        cancellation_moovu_amount: 0,
        cancellation_policy_code: "driver_cancelled",
        offer_status: null,
        offer_expires_at: null,
      })
      .eq("id", tripId)
      .eq("driver_id", driverId);

    if (isMissingCancellationColumn(updateResult.error)) {
      updateResult = await supabaseAdmin
        .from("trips")
        .update({
          status: "cancelled",
          cancel_reason: reason,
          cancelled_by: "driver",
          cancellation_fee_amount: 0,
          cancellation_policy_code: "driver_cancelled",
          offer_status: null,
          offer_expires_at: null,
        })
        .eq("id", tripId)
        .eq("driver_id", driverId);
    }

    if (updateResult.error) {
      return NextResponse.json({ ok: false, error: updateResult.error.message }, { status: 500 });
    }

    await supabaseAdmin.from("drivers").update({ busy: false }).eq("id", driverId);

    try {
      await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "trip_cancelled_driver",
        message: `Trip cancelled by driver. Reason: ${reason}`,
        old_status: trip.status,
        new_status: "cancelled",
        created_by: user.id,
      });
    } catch (eventError) {
      console.error("[driver-cancel-trip] trip event insert failed", eventError);
    }

    await notifyCustomerForTrip(
      tripId,
      "Trip cancelled",
      `Your driver cancelled the trip. Reason: ${reason}`,
      `/ride/${tripId}`
    );

    await notifyAdmins(
      "Trip cancelled by driver",
      `Trip ${tripId} was cancelled by the driver. Reason: ${reason}`,
      "/admin/trips"
    );

    return NextResponse.json({ ok: true, message: "Trip cancelled successfully." });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
