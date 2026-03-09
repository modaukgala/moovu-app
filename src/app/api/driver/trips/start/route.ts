import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDriverIdForUser, getUserFromBearer } from "@/app/api/driver/utils";

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });

    const driverId = await getDriverIdForUser(user.id);
    if (!driverId) return NextResponse.json({ ok: false, error: "Not linked" }, { status: 403 });

    const { tripId } = await req.json();
    if (!tripId) return NextResponse.json({ ok: false, error: "Missing tripId" }, { status: 400 });

    const { data: trip } = await supabaseAdmin
      .from("trips")
      .select("id,driver_id,status")
      .eq("id", tripId)
      .single();

    if (!trip) return NextResponse.json({ ok: false, error: "Trip not found" }, { status: 404 });
    if (trip.driver_id !== driverId) return NextResponse.json({ ok: false, error: "Not your trip" }, { status: 403 });

    if (trip.status !== "arrived" && trip.status !== "assigned") {
      return NextResponse.json(
        { ok: false, error: `Trip must be 'assigned' or 'arrived' to start. Current: ${trip.status}` },
        { status: 400 }
      );
    }

    await supabaseAdmin.from("trips").update({ status: "started" }).eq("id", tripId);

    await supabaseAdmin.from("trip_events").insert({
      trip_id: tripId,
      event_type: "started",
      message: "Trip started",
      old_status: trip.status,
      new_status: "started",
    });

    return NextResponse.json({ ok: true, status: "started" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}