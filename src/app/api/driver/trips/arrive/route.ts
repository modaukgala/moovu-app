import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDriverIdForUser, getUserFromBearer } from "@/app/api/driver/_utils";

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

    if (trip.status !== "assigned") {
      return NextResponse.json({ ok: false, error: `Trip must be 'assigned' to arrive. Current: ${trip.status}` }, { status: 400 });
    }

    await supabaseAdmin.from("trips").update({ status: "arrived" }).eq("id", tripId);

    await supabaseAdmin.from("trip_events").insert({
      trip_id: tripId,
      event_type: "arrived",
      message: "Driver arrived at pickup",
      old_status: "assigned",
      new_status: "arrived",
    });

    return NextResponse.json({ ok: true, status: "arrived" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}