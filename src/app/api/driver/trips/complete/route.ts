import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { applyTripCommissionServer } from "@/lib/finance/applyTripCommissionServer";
import {
  COMPLETION_RADIUS_KM,
  haversineKm,
  isFreshHeartbeat,
  minimumRequiredTripSeconds,
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
        { ok: false, error: "End OTP is required to complete the trip." },
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
      .select(
        "id,status,driver_id,fare_amount,duration_min,dropoff_lat,dropoff_lng,end_otp,end_otp_verified"
      )
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

    if (trip.status !== "ongoing") {
      return NextResponse.json(
        { ok: false, error: "Only ongoing trips can be completed." },
        { status: 400 }
      );
    }

    if (!trip.end_otp) {
      return NextResponse.json(
        { ok: false, error: "End OTP is missing." },
        { status: 400 }
      );
    }

    if (otp !== String(trip.end_otp)) {
      return NextResponse.json(
        { ok: false, error: "Incorrect end OTP." },
        { status: 400 }
      );
    }

    const fareAmount = Number(trip.fare_amount || 0);
    if (!Number.isFinite(fareAmount) || fareAmount <= 0) {
      return NextResponse.json(
        { ok: false, error: "Trip fare is missing or invalid." },
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

    if (driver.lat == null || driver.lng == null) {
      return NextResponse.json(
        {
          ok: false,
          error: "Driver GPS location is missing. Please refresh location first.",
        },
        { status: 400 }
      );
    }

    if (!isFreshHeartbeat(driver.last_seen)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Driver location is stale. Refresh your GPS and try again.",
        },
        { status: 400 }
      );
    }

    if (trip.dropoff_lat != null && trip.dropoff_lng != null) {
      const kmAway = haversineKm(
        Number(driver.lat),
        Number(driver.lng),
        Number(trip.dropoff_lat),
        Number(trip.dropoff_lng)
      );

      if (kmAway > COMPLETION_RADIUS_KM) {
        return NextResponse.json(
          {
            ok: false,
            error: "You need to be within the destination area before completing this trip.",
          },
          { status: 400 }
        );
      }
    }

    const { data: startEvents, error: startEventError } = await supabaseAdmin
      .from("trip_events")
      .select("created_at")
      .eq("trip_id", tripId)
      .eq("event_type", "trip_started")
      .order("created_at", { ascending: false })
      .limit(1);

    if (startEventError) {
      return NextResponse.json(
        { ok: false, error: startEventError.message },
        { status: 500 }
      );
    }

    const startedAt = startEvents?.[0]?.created_at
      ? new Date(startEvents[0].created_at).getTime()
      : null;

    if (!startedAt) {
      return NextResponse.json(
        { ok: false, error: "Trip start record is missing." },
        { status: 400 }
      );
    }

    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const minRequiredSeconds = minimumRequiredTripSeconds(
      Number(trip.duration_min || 0)
    );

    if (elapsedSeconds < minRequiredSeconds) {
      return NextResponse.json(
        {
          ok: false,
          error: `Trip cannot be completed yet. Minimum required time is ${Math.ceil(
            minRequiredSeconds / 60
          )} min.`,
        },
        { status: 400 }
      );
    }

    const commissionResult = await applyTripCommissionServer({
      tripId,
      driverId,
      fareAmount,
      createdBy: user.id,
    });

    if (!commissionResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Commission failed, so trip was not completed: ${commissionResult.error}`,
        },
        { status: 500 }
      );
    }

    const { error: updateTripError } = await supabaseAdmin
      .from("trips")
      .update({
        status: "completed",
        end_otp_verified: true,
      })
      .eq("id", tripId)
      .eq("status", "ongoing");

    if (updateTripError) {
      return NextResponse.json(
        { ok: false, error: updateTripError.message },
        { status: 500 }
      );
    }

    await supabaseAdmin
      .from("drivers")
      .update({ busy: false })
      .eq("id", driverId);

    try {
      await supabaseAdmin.from("trip_events").insert([
        {
          trip_id: tripId,
          event_type: "end_otp_verified",
          message: "Passenger end OTP verified by driver",
          old_status: "ongoing",
          new_status: "ongoing",
        },
        {
          trip_id: tripId,
          event_type: "trip_completed",
          message: "Trip completed successfully",
          old_status: "ongoing",
          new_status: "completed",
        },
        {
          trip_id: tripId,
          event_type: "commission_applied",
          message: commissionResult.skipped
            ? "Commission already existed for this trip"
            : `Commission applied: R${commissionResult.calc.commissionAmount} | Driver net: R${commissionResult.calc.driverNet}`,
          old_status: "completed",
          new_status: "completed",
        },
      ]);
    } catch {}

    await notifyCustomerForTrip(
      tripId,
      "Trip completed",
      "Your trip has been completed successfully.",
      `/ride/${tripId}`
    );

    await notifyAdmins(
      "Trip completed",
      `Trip ${tripId} was completed successfully.`,
      "/admin/trips"
    );

    return NextResponse.json({
      ok: true,
      message: "Trip completed successfully.",
      elapsedSeconds,
      minRequiredSeconds,
      commission: {
        skipped: commissionResult.skipped,
        fareAmount: commissionResult.calc.fareAmount,
        commissionPct: commissionResult.calc.commissionPct,
        commissionAmount: commissionResult.calc.commissionAmount,
        driverNet: commissionResult.calc.driverNet,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
