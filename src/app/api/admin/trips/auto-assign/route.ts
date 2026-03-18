import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const tripId = String(body?.tripId ?? "").trim();
    const driverId = String(body?.driverId ?? "").trim();

    if (!tripId || !driverId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID and Driver ID are required." },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id,status,driver_id,pickup_address,dropoff_address")
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
        { ok: false, error: "Completed trips cannot be reassigned." },
        { status: 400 }
      );
    }

    if (trip.status === "cancelled") {
      return NextResponse.json(
        { ok: false, error: "Cancelled trips cannot be assigned." },
        { status: 400 }
      );
    }

    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select("id,first_name,last_name,phone,status,online,busy")
      .eq("id", driverId)
      .maybeSingle();

    if (driverError) {
      return NextResponse.json(
        { ok: false, error: driverError.message },
        { status: 500 }
      );
    }

    if (!driver) {
      return NextResponse.json(
        { ok: false, error: "Driver not found." },
        { status: 404 }
      );
    }

    const { error: updateTripError } = await supabase
      .from("trips")
      .update({
        driver_id: driverId,
        status: "assigned",
        offer_status: "accepted",
      })
      .eq("id", tripId);

    if (updateTripError) {
      return NextResponse.json(
        { ok: false, error: updateTripError.message },
        { status: 500 }
      );
    }

    await supabase
      .from("drivers")
      .update({
        busy: true,
      })
      .eq("id", driverId);

    try {
      await supabase.from("trip_events").insert({
        trip_id: tripId,
        event_type: "driver_assigned",
        message: `Driver manually assigned by admin`,
        old_status: trip.status,
        new_status: "assigned",
      });
    } catch {
      // ignore logging failure
    }

    const { data: driverAccount } = await supabase
      .from("driver_accounts")
      .select("user_id")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (driverAccount?.user_id) {
      try {
        await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/push/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userIds: [driverAccount.user_id],
            title: "New trip assigned",
            body: `You have been assigned a new trip from ${trip.pickup_address ?? "pickup"} to ${trip.dropoff_address ?? "destination"}.`,
            url: "/driver",
          }),
        });
      } catch {
        // ignore push failure
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Driver assigned successfully.",
      tripId,
      driverId,
      driverName: `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}