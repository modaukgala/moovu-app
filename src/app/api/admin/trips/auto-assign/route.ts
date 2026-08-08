import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { dispatchTrip } from "@/lib/dispatch/dispatchTrip";
import { isDispatchExpired } from "@/lib/dispatch/config";

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const body = await req.json();
    const tripId = String(body?.tripId ?? "").trim();

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID is required." },
        { status: 400 }
      );
    }

    const { supabaseAdmin, user } = auth;

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,status,driver_id,created_at,dispatch_cycle")
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

    if (!["requested", "offered"].includes(String(trip.status))) {
      return NextResponse.json(
        { ok: false, error: "Only requested/offered trips can be auto-assigned." },
        { status: 400 }
      );
    }

    if (trip.driver_id) {
      return NextResponse.json(
        { ok: false, error: "This trip already has an assigned driver." },
        { status: 400 }
      );
    }

    if (isDispatchExpired(trip.created_at)) {
      return NextResponse.json(
        { ok: false, error: "Dispatch window expired. Trips can only be re-offered within 30 minutes of the original request." },
        { status: 410 }
      );
    }

    const result = await dispatchTrip({
      tripId,
      cycle: Math.max(1, Number(trip.dispatch_cycle ?? 0) + 1),
      allowAfterAutomaticExhaustion: true,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.exhausted ? 410 : 500 }
      );
    }

    try {
      await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "auto_assign_attempt",
        message: `Auto-assign offered trip to driver ${result.driverId ?? "pending"}`,
        old_status: trip.status,
        new_status: "offered",
        created_by: user.id,
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      message: "Nearest driver offered successfully.",
      driverId: result.driverId,
      expiresAt: result.expiresAt,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error." },
      { status: 500 }
    );
  }
}
