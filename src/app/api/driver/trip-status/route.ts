import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function getUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) return null;

  // @ts-ignore
  const { data } = await supabaseAdmin.auth.getUser(token);

  return data?.user ?? null;
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }

    const { tripId, action } = await req.json();

    const { data: mapping } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .single();

    if (!mapping?.driver_id) {
      return NextResponse.json({ ok: false, error: "Driver not linked" });
    }

    const driverId = mapping.driver_id;

    const { data: trip } = await supabaseAdmin
      .from("trips")
      .select("*")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return NextResponse.json({ ok: false, error: "Trip not found" });
    }

    if (action === "arrived") {
      await supabaseAdmin
        .from("trips")
        .update({ status: "arrived" })
        .eq("id", tripId);

      await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "driver_arrived",
        message: "Driver arrived at pickup",
        old_status: trip.status,
        new_status: "arrived",
      });
    }

    if (action === "start") {
      await supabaseAdmin
        .from("trips")
        .update({ status: "started" })
        .eq("id", tripId);

      await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "trip_started",
        message: "Trip started",
        old_status: trip.status,
        new_status: "started",
      });
    }

    if (action === "complete") {
      await supabaseAdmin
        .from("trips")
        .update({ status: "completed" })
        .eq("id", tripId);

      await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "trip_completed",
        message: "Trip completed",
        old_status: trip.status,
        new_status: "completed",
      });

      await supabaseAdmin
        .from("drivers")
        .update({ busy: false })
        .eq("id", driverId);
    }

    return NextResponse.json({ ok: true });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}