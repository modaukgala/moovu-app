import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { user, supabaseAdmin } = auth;
    const body = await req.json();

    const tripId = String(body?.tripId ?? "").trim();
    const reason = String(body?.reason ?? "Cancelled by admin").trim();

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID is required." },
        { status: 400 }
      );
    }

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,status,driver_id")
      .eq("id", tripId)
      .maybeSingle();

    if (tripError) {
      return NextResponse.json(
        { ok: false, error: tripError.message },
        { status: 500 }
      );
    }

    if (!trip) {
      return NextResponse.json(
        { ok: false, error: "Trip not found." },
        { status: 404 }
      );
    }

    if (trip.status === "completed") {
      return NextResponse.json(
        { ok: false, error: "Completed trip cannot be cancelled." },
        { status: 400 }
      );
    }

    if (trip.status === "cancelled") {
      return NextResponse.json(
        { ok: false, error: "Trip is already cancelled." },
        { status: 400 }
      );
    }

    const { error: updateTripError } = await supabaseAdmin
      .from("trips")
      .update({
        status: "cancelled",
        cancel_reason: reason,
        cancelled_by: "admin",
        cancellation_fee_amount: 0,
        cancellation_policy_code: "admin_cancelled",
        offer_status: null,
        offer_expires_at: null,
      })
      .eq("id", tripId);

    if (updateTripError) {
      return NextResponse.json(
        { ok: false, error: updateTripError.message },
        { status: 500 }
      );
    }

    if (trip.driver_id) {
      await supabaseAdmin
        .from("drivers")
        .update({ busy: false })
        .eq("id", trip.driver_id);
    }

    try {
      await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "trip_cancelled_admin",
        message: `Trip cancelled by admin. Reason: ${reason}`,
        old_status: trip.status,
        new_status: "cancelled",
        created_by: user.id,
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      message: "Trip cancelled successfully.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}