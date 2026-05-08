import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { NO_SHOW_FEE, isNoShowEligible, noShowEligibleAt } from "@/lib/finance/cancellationFees";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";

function isMissingCancellationColumn(error: { message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return message.includes("cancellation_") || message.includes("cancelled_at") || message.includes("driver_arrived_at");
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const tripId = String(body?.tripId ?? "").trim();

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
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
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mappingError || !mapping?.driver_id) {
      return NextResponse.json({ ok: false, error: "Driver account not linked." }, { status: 403 });
    }

    const driverId = mapping.driver_id;

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,status,customer_id,driver_id")
      .eq("id", tripId)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json(
        { ok: false, error: tripError?.message || "Trip not found." },
        { status: 404 }
      );
    }

    if (trip.driver_id !== driverId) {
      return NextResponse.json({ ok: false, error: "This trip is not assigned to you." }, { status: 403 });
    }

    if (trip.status !== "arrived") {
      return NextResponse.json({ ok: false, error: "Only arrived trips can be marked no-show." }, { status: 400 });
    }

    const { data: arrivedEvents } = await supabaseAdmin
      .from("trip_events")
      .select("created_at")
      .eq("trip_id", tripId)
      .eq("event_type", "driver_arrived")
      .order("created_at", { ascending: false })
      .limit(1);

    const arrivedAt = arrivedEvents?.[0]?.created_at ?? null;
    const eligibleAt = noShowEligibleAt(arrivedAt);

    if (!isNoShowEligible(arrivedAt)) {
      return NextResponse.json(
        {
          ok: false,
          error: eligibleAt
            ? `You can mark no-show after ${new Date(eligibleAt).toLocaleTimeString()}.`
            : "Arrival time is missing. Mark arrived again or contact admin.",
          noShowEligibleAt: eligibleAt,
        },
        { status: 400 }
      );
    }

    const { error: feeInsertError } = await supabaseAdmin.from("trip_cancellation_fees").insert({
      trip_id: tripId,
      customer_id: trip.customer_id,
      driver_id: driverId,
      fee_type: NO_SHOW_FEE.type,
      fee_amount: NO_SHOW_FEE.feeAmount,
      driver_amount: NO_SHOW_FEE.driverAmount,
      moovu_amount: NO_SHOW_FEE.moovuAmount,
      reason: "Customer no-show",
      created_by: user.id,
    });

    if (feeInsertError) {
      console.error("[driver-no-show] fee insert failed", {
        tripId,
        driverId,
        reason: feeInsertError.message,
      });
      return NextResponse.json(
        { ok: false, error: "No-show fee could not be recorded. Please try again or contact support." },
        { status: 500 }
      );
    }

    const cancelledAt = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from("trips")
      .update({
        status: "cancelled",
        cancel_reason: "Customer no-show",
        cancellation_reason: "Customer no-show",
        cancellation_type: NO_SHOW_FEE.type,
        cancelled_by: "driver",
        cancelled_at: cancelledAt,
        cancellation_fee_amount: NO_SHOW_FEE.feeAmount,
        cancellation_driver_amount: NO_SHOW_FEE.driverAmount,
        cancellation_moovu_amount: NO_SHOW_FEE.moovuAmount,
        cancellation_policy_code: NO_SHOW_FEE.policyCode,
        driver_arrived_at: arrivedAt,
        no_show_eligible_at: eligibleAt,
      })
      .eq("id", tripId)
      .eq("status", "arrived");

    if (updateError && isMissingCancellationColumn(updateError)) {
      const { error: legacyUpdateError } = await supabaseAdmin
        .from("trips")
        .update({
          status: "cancelled",
          cancel_reason: "Customer no-show",
          cancelled_by: "driver",
          cancellation_fee_amount: NO_SHOW_FEE.feeAmount,
          cancellation_policy_code: NO_SHOW_FEE.policyCode,
        })
        .eq("id", tripId)
        .eq("status", "arrived");

      if (legacyUpdateError) {
        return NextResponse.json({ ok: false, error: legacyUpdateError.message }, { status: 500 });
      }
    } else if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    await supabaseAdmin.from("drivers").update({ busy: false }).eq("id", driverId);

    const { error: eventError } = await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "customer_no_show",
        message: `Customer no-show marked. Fee R${NO_SHOW_FEE.feeAmount}. Driver payout R${NO_SHOW_FEE.driverAmount}. MOOVU revenue R${NO_SHOW_FEE.moovuAmount}.`,
        old_status: "arrived",
        new_status: "cancelled",
      });

    if (eventError) {
      console.error("[driver-no-show] event insert failed", {
        tripId,
        reason: eventError.message,
      });
    }

    await notifyCustomerForTrip(
      tripId,
      "Trip marked no-show",
      `Your trip was marked no-show. A R${NO_SHOW_FEE.feeAmount} fee may apply.`,
      `/ride/${tripId}`
    );

    await notifyAdmins(
      "Customer no-show",
      `Trip ${tripId} was marked as customer no-show.`,
      "/admin/trips"
    );

    return NextResponse.json({
      ok: true,
      message: `No-show recorded. Driver payout: R${NO_SHOW_FEE.driverAmount}.`,
      fee: NO_SHOW_FEE,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
