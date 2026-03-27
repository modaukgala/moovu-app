import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { offerNextDriver } from "@/lib/dispatch/offerNextDriver";

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
      .select("id,status")
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

    const result = await offerNextDriver({ tripId });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 500 }
      );
    }

    try {
      await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "auto_assign_attempt",
        message: result.reassigned
          ? `Auto-assign offered trip to driver ${result.driverId}`
          : result.message,
        old_status: trip.status,
        new_status: result.reassigned ? "offered" : trip.status,
        created_by: user.id,
      });
    } catch {}

    if (!result.reassigned) {
      return NextResponse.json(
        { ok: false, error: result.message },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Nearest driver offered successfully.",
      driverId: result.driverId,
      driverName: result.driverName,
      expiresAt: result.expiresAt,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}