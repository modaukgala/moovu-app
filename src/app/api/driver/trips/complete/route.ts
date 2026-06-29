import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateFinalFare } from "@/lib/domain/fare";
import { applyTripCommissionServer } from "@/lib/finance/applyTripCommissionServer";
import {
  haversineKm,
  isFreshHeartbeat,
  minimumRequiredTripSeconds,
} from "@/lib/geo/tripGuards";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";

function roundedKm(value: number | null) {
  return value == null ? null : Math.round(value * 100) / 100;
}

type CompleteTripRow = {
  id: string;
  status: string;
  driver_id: string | null;
  fare_amount: number | null;
  duration_min: number | null;
  distance_km?: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  end_otp: string | null;
  end_otp_verified: boolean | null;
  ride_option?: string | null;
  original_fare?: number | null;
  final_add_stop_increase?: number | null;
  stop_waiting_fee?: number | null;
  final_fare?: number | null;
  route_distance_km?: number | null;
  route_duration_min?: number | null;
  estimated_fare?: number | null;
  current_fare?: number | null;
  actual_distance_km?: number | null;
  actual_duration_min?: number | null;
  actual_fare_breakdown?: unknown;
};

const COMPLETE_TRIP_SELECT = `
  id,
  status,
  driver_id,
  fare_amount,
  duration_min,
  distance_km,
  dropoff_lat,
  dropoff_lng,
  end_otp,
  end_otp_verified,
  ride_option,
  original_fare,
  final_add_stop_increase,
  stop_waiting_fee,
  final_fare,
  route_distance_km,
  route_duration_min,
  estimated_fare
  ,current_fare
  ,actual_distance_km
  ,actual_duration_min
  ,actual_fare_breakdown
`;

const LEGACY_COMPLETE_TRIP_SELECT =
  "id,status,driver_id,fare_amount,duration_min,dropoff_lat,dropoff_lng,end_otp,end_otp_verified,ride_option";

function isMissingFinalFareColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42703" && (
    message.includes("distance_km") ||
    message.includes("original_fare") ||
    message.includes("final_add_stop_increase") ||
    message.includes("stop_waiting_fee") ||
    message.includes("final_fare") ||
    message.includes("route_distance_km") ||
    message.includes("route_duration_min") ||
    message.includes("estimated_fare") ||
    message.includes("fare_adjustment_amount") ||
    message.includes("fare_adjustment_reason") ||
    message.includes("fare_finalized_at") ||
    message.includes("actual_distance_km") ||
    message.includes("actual_duration_min") ||
    message.includes("actual_route_source") ||
    message.includes("current_fare") ||
    message.includes("actual_fare_breakdown")
  );
}

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

    let tripQuery = await supabaseAdmin
      .from("trips")
      .select(COMPLETE_TRIP_SELECT)
      .eq("id", tripId)
      .maybeSingle();

    if (isMissingFinalFareColumn(tripQuery.error)) {
      tripQuery = await supabaseAdmin
        .from("trips")
        .select(LEGACY_COMPLETE_TRIP_SELECT)
        .eq("id", tripId)
        .maybeSingle();
    }

    const { data: trip, error: tripError } = tripQuery;

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

    const typedTrip = trip as CompleteTripRow;

    if (typedTrip.driver_id !== driverId) {
      return NextResponse.json(
        { ok: false, error: "This trip is not assigned to you." },
        { status: 403 }
      );
    }

    if (typedTrip.status !== "ongoing") {
      return NextResponse.json(
        { ok: false, error: "Only ongoing trips can be completed." },
        { status: 400 }
      );
    }

    if (!typedTrip.end_otp) {
      return NextResponse.json(
        { ok: false, error: "End OTP is missing." },
        { status: 400 }
      );
    }

    if (otp !== String(typedTrip.end_otp)) {
      return NextResponse.json(
        { ok: false, error: "Incorrect end OTP." },
        { status: 400 }
      );
    }

    const finalizedFare = calculateFinalFare({
      originalFare: typedTrip.original_fare,
      addStopIncrease: typedTrip.final_add_stop_increase,
      stopWaitingFee: typedTrip.stop_waiting_fee,
      fallbackFare: typedTrip.final_fare ?? typedTrip.fare_amount,
    });
    const liveFare = Number(typedTrip.current_fare ?? 0);
    const fareAmount = Number((Number.isFinite(liveFare) && liveFare > 0 ? liveFare : finalizedFare.finalFare) || 0);
    const effectiveFare = {
      ...finalizedFare,
      finalFare: Math.round(fareAmount),
      adjustmentAmount: Math.round((fareAmount - finalizedFare.estimatedFare) * 100) / 100,
    };
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

    let kmAway: number | null = null;
    let distanceAudit = "Trip completion distance audit unavailable.";

    if (driver.lat == null || driver.lng == null) {
      distanceAudit = "Trip completed with OTP; driver GPS location was unavailable.";
    } else if (typedTrip.dropoff_lat == null || typedTrip.dropoff_lng == null) {
      distanceAudit = "Trip completed with OTP; destination coordinates were unavailable.";
    } else {
      kmAway = haversineKm(
        Number(driver.lat),
        Number(driver.lng),
        Number(typedTrip.dropoff_lat),
        Number(typedTrip.dropoff_lng)
      );

      const freshnessNote = isFreshHeartbeat(driver.last_seen)
        ? ""
        : " using last known GPS";
      distanceAudit = `Trip completed with OTP ${kmAway.toFixed(2)} km from destination${freshnessNote}.`;
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
      Number(typedTrip.duration_min || 0)
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
      rideOptionId: typedTrip.ride_option,
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

    const completedAt = new Date().toISOString();
    const finalFareUpdate = {
      status: "completed",
      end_otp_verified: true,
      fare_amount: effectiveFare.finalFare,
      final_fare: effectiveFare.finalFare,
      estimated_fare: effectiveFare.estimatedFare,
      fare_adjustment_amount: effectiveFare.adjustmentAmount,
      fare_adjustment_reason:
        effectiveFare.adjustmentAmount !== 0 ? "finalized_from_live_trip" : "finalized_without_adjustment",
      fare_finalized_at: completedAt,
      actual_distance_km: typedTrip.actual_distance_km ?? typedTrip.route_distance_km ?? typedTrip.distance_km ?? null,
      actual_duration_min: typedTrip.actual_duration_min ?? typedTrip.route_duration_min ?? typedTrip.duration_min ?? null,
      actual_route_source: typedTrip.actual_distance_km != null ? "gps_audit" : "route_estimate",
    };

    let updateTripResult = await supabaseAdmin
      .from("trips")
      .update(finalFareUpdate)
      .eq("id", tripId)
      .eq("status", "ongoing");

    if (isMissingFinalFareColumn(updateTripResult.error)) {
      updateTripResult = await supabaseAdmin
        .from("trips")
        .update({
          status: "completed",
          end_otp_verified: true,
          fare_amount: effectiveFare.finalFare,
        })
        .eq("id", tripId)
        .eq("status", "ongoing");
    }

    const { error: updateTripError } = updateTripResult;
    if (updateTripError) {
      return NextResponse.json(
        { ok: false, error: updateTripError.message },
        { status: 500 }
      );
    }

    const walletRefreshResult = await applyTripCommissionServer({
      tripId,
      driverId,
      fareAmount,
      createdBy: user.id,
      rideOptionId: typedTrip.ride_option,
    });
    if (!walletRefreshResult.ok) {
      console.error("[driver-complete] post-completion wallet refresh failed", walletRefreshResult.error);
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
          event_type: "fare_finalized",
          message: `Final fare confirmed at R${effectiveFare.finalFare}. Adjustment: R${effectiveFare.adjustmentAmount}.`,
          old_status: "ongoing",
          new_status: "ongoing",
        },
        {
          trip_id: tripId,
          event_type: "trip_completed",
          message: distanceAudit,
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
      "Trip Completed",
      "Your trip has been completed successfully.",
      `/ride/${tripId}`
    );

    await notifyAdmins(
      "Trip Completed",
      `Trip ${tripId} was completed successfully.`,
      "/admin/trips"
    );

    return NextResponse.json({
      ok: true,
      message: "Trip completed successfully.",
      kmAway: roundedKm(kmAway),
      distanceAudit,
      elapsedSeconds,
      minRequiredSeconds,
      commission: {
        skipped: commissionResult.skipped,
        fareAmount: commissionResult.calc.fareAmount,
        commissionPct: commissionResult.calc.commissionPct,
        commissionAmount: commissionResult.calc.commissionAmount,
        driverNet: commissionResult.calc.driverNet,
      },
      fare: effectiveFare,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
