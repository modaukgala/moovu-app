import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ARRIVAL_RADIUS_KM,
  haversineKm,
  isFreshHeartbeat,
} from "@/lib/geo/tripGuards";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing access token." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const tripId = String(body?.tripId ?? "").trim();
    const otp = String(body?.otp ?? "").trim();

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID is required." },
        { status: 400 }
      );
    }

    if (!otp) {
      return NextResponse.json(
        { ok: false, error: "OTP is required to start the trip." },
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
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 }
      );
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
      .select("id,status,driver_id,pickup_lat,pickup_lng,start_otp,start_otp_verified")
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

    if (trip.driver_id !== driverId) {
      return NextResponse.json(
        { ok: false, error: "This trip is not assigned to you." },
        { status: 403 }
      );
    }

    if (trip.status !== "arrived") {
      return NextResponse.json(
        { ok: false, error: "Only arrived trips can be started." },
        { status: 400 }
      );
    }

    if (!trip.start_otp) {
      return NextResponse.json(
        { ok: false, error: "Start OTP is missing." },
        { status: 400 }
      );
    }

    if (otp !== String(trip.start_otp)) {
      return NextResponse.json(
        { ok: false, error: "Incorrect start OTP." },
        { status: 400 }
      );
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id,lat,lng,last_seen")
      .eq("id", driverId)
      .maybeSingle();

    if (driverError || !driver) {
      return NextResponse.json(
        { ok: false, error: "Driver not found." },
        { status: 404 }
      );
    }

    if (trip.pickup_lat == null || trip.pickup_lng == null) {
      return NextResponse.json(
        { ok: false, error: "Trip pickup coordinates are missing." },
        { status: 400 }
      );
    }

    if (driver.lat == null || driver.lng == null) {
      return NextResponse.json(
        { ok: false, error: "Driver GPS location is missing. Please refresh location first." },
        { status: 400 }
      );
    }

    if (!isFreshHeartbeat(driver.last_seen)) {
      return NextResponse.json(
        { ok: false, error: "Driver location is stale. Refresh your GPS and try again." },
        { status: 400 }
      );
    }

    const kmAway = haversineKm(
      Number(driver.lat),
      Number(driver.lng),
      Number(trip.pickup_lat),
      Number(trip.pickup_lng)
    );

    if (kmAway > ARRIVAL_RADIUS_KM) {
      return NextResponse.json(
        {
          ok: false,
          error: `You are too far from pickup to start the trip. Distance is ${kmAway.toFixed(2)} km.`,
        },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("trips")
      .update({
        status: "ongoing",
        start_otp_verified: true,
        otp_verified: true,
      })
      .eq("id", tripId);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      );
    }

    try {
      await supabaseAdmin.from("trip_events").insert([
        {
          trip_id: tripId,
          event_type: "start_otp_verified",
          message: "Passenger start OTP verified by driver",
          old_status: "arrived",
          new_status: "arrived",
        },
        {
          trip_id: tripId,
          event_type: "trip_started",
          message: `Trip started (${kmAway.toFixed(2)} km from pickup)`,
          old_status: "arrived",
          new_status: "ongoing",
        },
      ]);
    } catch {}

    await notifyCustomerForTrip(
      tripId,
      "Trip started",
      "Your ride is now in progress.",
      "/book"
    );

    await notifyAdmins(
      "Trip started",
      `Trip ${tripId} has started.`,
      "/admin/trips"
    );

    return NextResponse.json({
      ok: true,
      message: "Trip started successfully.",
      kmAway: Math.round(kmAway * 100) / 100,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
