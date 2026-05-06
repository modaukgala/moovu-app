import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error";
}

async function getUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) return null;

  const { data } = await supabaseAdmin.auth.getUser(token);
  return data?.user ?? null;
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not logged in" },
        { status: 401 }
      );
    }

    const { tripId, action } = await req.json();

    if (!tripId || !action) {
      return NextResponse.json(
        { ok: false, error: "tripId and action are required" },
        { status: 400 }
      );
    }

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .single();

    if (mappingError || !mapping?.driver_id) {
      return NextResponse.json(
        { ok: false, error: "Driver not linked" },
        { status: 403 }
      );
    }

    const driverId = mapping.driver_id;

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,status,driver_id")
      .eq("id", tripId)
      .single();

    if (tripError || !trip) {
      return NextResponse.json(
        { ok: false, error: "Trip not found" },
        { status: 404 }
      );
    }

    if (trip.driver_id !== driverId) {
      return NextResponse.json(
        { ok: false, error: "This trip is not assigned to you" },
        { status: 403 }
      );
    }

    let newStatus: string | null = null;
    let eventType: string | null = null;
    let message: string | null = null;

    if (action === "arrived") {
      if (trip.status !== "assigned") {
        return NextResponse.json(
          { ok: false, error: "Only assigned trips can be marked arrived" },
          { status: 400 }
        );
      }

      newStatus = "arrived";
      eventType = "driver_arrived";
      message = "Driver arrived at pickup";
    } else if (action === "start") {
      if (!["assigned", "arrived"].includes(String(trip.status))) {
        return NextResponse.json(
          { ok: false, error: "Only assigned or arrived trips can be started" },
          { status: 400 }
        );
      }

      newStatus = "ongoing";
      eventType = "trip_started";
      message = "Trip started";
    } else if (action === "complete") {
      if (trip.status !== "ongoing") {
        return NextResponse.json(
          { ok: false, error: "Only ongoing trips can be completed" },
          { status: 400 }
        );
      }

      newStatus = "completed";
      eventType = "trip_completed";
      message = "Trip completed";
    } else {
      return NextResponse.json(
        { ok: false, error: "Invalid action" },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("trips")
      .update({ status: newStatus })
      .eq("id", tripId);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      );
    }

    try {
      await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: eventType,
        message,
        old_status: trip.status,
        new_status: newStatus,
      });
    } catch {}

    if (action === "complete") {
      try {
        await supabaseAdmin
          .from("drivers")
          .update({ busy: false })
          .eq("id", driverId);
      } catch {}
    }

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
