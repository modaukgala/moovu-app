import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FinalFareBreakdown } from "@/lib/domain/fare";
import { applyTripCommissionServer } from "@/lib/finance/applyTripCommissionServer";
import { haversineKm, isFreshHeartbeat, minimumRequiredTripSeconds } from "@/lib/geo/tripGuards";
import { notifyAdmins, notifyCustomerForTrip, notifyDriverForTrip } from "@/lib/push-notify";
import {
  buildCompletionAuditFields,
  completionSchemaErrorMessage,
  completionSchemaSelect,
  END_OTP_BYPASS_REASONS,
  missingCompletionColumn,
  type CompletionMode,
} from "@/lib/trips/completionContract";
import { buildLockedFareBreakdown, resolveLockedTripFare } from "@/lib/trips/lockedTripFare";

export { END_OTP_BYPASS_REASONS } from "@/lib/trips/completionContract";

type CompletionTrip = {
  id: string;
  status: string;
  driver_id: string | null;
  fare_amount: number | null;
  duration_min: number | null;
  distance_km?: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  start_otp_verified: boolean | null;
  end_otp: string | null;
  end_otp_verified: boolean | null;
  trip_started_at?: string | null;
  ride_option?: string | null;
  original_fare?: number | null;
  final_add_stop_increase?: number | null;
  stop_waiting_fee?: number | null;
  final_fare?: number | null;
  route_distance_km?: number | null;
  route_duration_min?: number | null;
  estimated_fare?: number | null;
  actual_distance_km?: number | null;
  actual_duration_min?: number | null;
};

const COMPLETE_SELECT = `
  id,status,driver_id,fare_amount,duration_min,distance_km,dropoff_lat,dropoff_lng,
  start_otp_verified,end_otp,end_otp_verified,trip_started_at,ride_option,original_fare,final_add_stop_increase,
  stop_waiting_fee,final_fare,route_distance_km,route_duration_min,estimated_fare,
  actual_distance_km,actual_duration_min
`;

export type CompleteTripServerResult =
  | {
      ok: true;
      status: 200;
      message: string;
      fare: FinalFareBreakdown;
      commission: {
        skipped: boolean;
        fareAmount: number;
        commissionPct: number;
        commissionAmount: number;
        driverNet: number;
      };
      elapsedSeconds: number;
      minRequiredSeconds: number;
      distanceAudit: string;
      kmAway: number | null;
    }
  | { ok: false; status: number; error: string };

export async function completeTripServer(params: {
  tripId: string;
  actorId: string;
  driverId?: string | null;
  mode: CompletionMode;
  otp?: string;
  reason?: string;
  note?: string;
}): Promise<CompleteTripServerResult> {
  const { data, error } = await supabaseAdmin
    .from("trips")
    .select(COMPLETE_SELECT)
    .eq("id", params.tripId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: "Trip not found." };
  const trip = data as CompletionTrip;

  if (!trip.driver_id) {
    return { ok: false, status: 400, error: "This trip has no assigned driver." };
  }
  if (params.driverId && trip.driver_id !== params.driverId) {
    return { ok: false, status: 403, error: "This trip is not assigned to you." };
  }
  if (trip.status !== "ongoing") {
    if (trip.status === "completed") {
      return { ok: false, status: 409, error: "Trip has already been completed." };
    }
    if (trip.status === "cancelled") {
      return { ok: false, status: 400, error: "Cancelled trips cannot be completed." };
    }
    return { ok: false, status: 400, error: "Trip is not currently active." };
  }
  if (!trip.start_otp_verified) {
    return {
      ok: false,
      status: 400,
      error: "This trip has not been started correctly.",
    };
  }

  if (params.mode === "otp") {
    if (!params.otp?.trim()) return { ok: false, status: 400, error: "End OTP is required." };
    if (!trip.end_otp) return { ok: false, status: 400, error: "End OTP is missing." };
    if (params.otp.trim() !== String(trip.end_otp)) {
      return { ok: false, status: 400, error: "Incorrect end OTP." };
    }
  }

  if (params.mode === "bypass") {
    if (!END_OTP_BYPASS_REASONS.includes(params.reason as (typeof END_OTP_BYPASS_REASONS)[number])) {
      return { ok: false, status: 400, error: "Select why the End OTP is unavailable." };
    }
    if (params.reason === "Other" && String(params.note ?? "").trim().length < 3) {
      return { ok: false, status: 400, error: "Add a short note for the End OTP bypass." };
    }
  }

  if (params.mode === "admin" && String(params.note ?? "").trim().length < 3) {
    return { ok: false, status: 400, error: "Add an admin completion note." };
  }

  if (params.mode === "admin" || params.mode === "bypass") {
    const schemaProbe = await supabaseAdmin
      .from("trips")
      .select(completionSchemaSelect(params.mode))
      .eq("id", params.tripId)
      .maybeSingle();
    if (schemaProbe.error && missingCompletionColumn(schemaProbe.error)) {
      console.error("[trip-complete] completion schema is incomplete", {
        tripId: params.tripId,
        mode: params.mode,
        code: schemaProbe.error.code,
        message: schemaProbe.error.message,
      });
      return {
        ok: false,
        status: 503,
        error: completionSchemaErrorMessage(params.mode),
      };
    }
    if (schemaProbe.error) {
      return { ok: false, status: 500, error: schemaProbe.error.message };
    }
  }

  const { data: startEvents, error: startError } = await supabaseAdmin
    .from("trip_events")
    .select("created_at")
    .eq("trip_id", params.tripId)
    .eq("event_type", "trip_started")
    .order("created_at", { ascending: false })
    .limit(1);
  if (startError) return { ok: false, status: 500, error: startError.message };
  const startedAt = startEvents?.[0]?.created_at
    ? new Date(startEvents[0].created_at).getTime()
    : trip.trip_started_at
      ? new Date(trip.trip_started_at).getTime()
      : null;
  if (!startedAt) return { ok: false, status: 400, error: "Trip start record is missing." };

  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const minRequiredSeconds = minimumRequiredTripSeconds(Number(trip.duration_min ?? 0));
  if (elapsedSeconds < minRequiredSeconds) {
    return {
      ok: false,
      status: 400,
      error: `Trip cannot be completed yet. Minimum required time is ${Math.ceil(minRequiredSeconds / 60)} min.`,
    };
  }

  const lockedFare = buildLockedFareBreakdown({
    finalFare: trip.final_fare,
    fareAmount: trip.fare_amount,
    estimatedFare: trip.estimated_fare,
    originalFare: trip.original_fare,
  });
  if (!lockedFare) {
    return { ok: false, status: 400, error: "Trip fare is missing or invalid." };
  }
  const bookingFare = resolveLockedTripFare({
    finalFare: trip.estimated_fare,
    fareAmount: lockedFare.finalFare,
  }) ?? lockedFare.finalFare;
  const fare: FinalFareBreakdown = {
    ...lockedFare,
    estimatedFare: bookingFare,
    originalFare: bookingFare,
    addStopIncrease: Math.round(Math.max(0, lockedFare.finalFare - bookingFare) * 100) / 100,
    adjustmentAmount: Math.round(Math.max(0, lockedFare.finalFare - bookingFare) * 100) / 100,
  };
  const fareAmount = fare.finalFare;

  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("lat,lng,last_seen")
    .eq("id", trip.driver_id)
    .maybeSingle();
  let kmAway: number | null = null;
  let distanceAudit = "Trip completion distance audit unavailable.";
  if (driver?.lat != null && driver.lng != null && trip.dropoff_lat != null && trip.dropoff_lng != null) {
    kmAway = haversineKm(
      Number(driver.lat),
      Number(driver.lng),
      Number(trip.dropoff_lat),
      Number(trip.dropoff_lng),
    );
    distanceAudit = `Trip completed ${kmAway.toFixed(2)} km from destination${
      isFreshHeartbeat(driver.last_seen) ? "" : " using last known GPS"
    }.`;
  }

  const commissionResult = await applyTripCommissionServer({
    tripId: params.tripId,
    driverId: trip.driver_id,
    fareAmount,
    createdBy: params.actorId,
    rideOptionId: trip.ride_option,
  });
  if (!commissionResult.ok) {
    return { ok: false, status: 500, error: `Commission failed, so the trip was not completed: ${commissionResult.error}` };
  }

  const now = new Date().toISOString();
  const update = {
    status: "completed",
    completed_at: now,
    ...buildCompletionAuditFields({
      mode: params.mode,
      actorId: params.actorId,
      now,
      note: params.note,
      reason: params.reason,
    }),
    fare_amount: fare.finalFare,
    final_fare: fare.finalFare,
    estimated_fare: fare.estimatedFare,
    fare_adjustment_amount: fare.adjustmentAmount,
    fare_adjustment_reason: fare.adjustmentAmount > 0 ? "active_stop_added" : "finalized_without_adjustment",
    fare_finalized_at: now,
    actual_distance_km: trip.actual_distance_km ?? trip.route_distance_km ?? trip.distance_km ?? null,
    actual_duration_min: trip.actual_duration_min ?? trip.route_duration_min ?? trip.duration_min ?? null,
    actual_route_source:
      params.mode === "admin"
        ? "admin_override"
        : trip.actual_distance_km != null
          ? "gps_audit"
          : "route_estimate",
  };

  const updated = await supabaseAdmin
    .from("trips")
    .update(update)
    .eq("id", params.tripId)
    .eq("status", "ongoing")
    .select("id")
    .maybeSingle();

  if (updated.error && missingCompletionColumn(updated.error)) {
    if (params.mode === "admin" || params.mode === "bypass") {
      console.error("[trip-complete] completion update schema is incomplete", {
        tripId: params.tripId,
        mode: params.mode,
        code: updated.error.code,
        message: updated.error.message,
      });
      return {
        ok: false,
        status: 503,
        error: completionSchemaErrorMessage(params.mode),
      };
    }
    const legacy = await supabaseAdmin
      .from("trips")
      .update({
        status: "completed",
        end_otp_verified: true,
        fare_amount: fare.finalFare,
      })
      .eq("id", params.tripId)
      .eq("status", "ongoing")
      .select("id")
      .maybeSingle();
    if (legacy.error) return { ok: false, status: 500, error: legacy.error.message };
  } else if (updated.error) {
    return { ok: false, status: 500, error: updated.error.message };
  } else if (!updated.data?.id) {
    return { ok: false, status: 409, error: "Trip status changed while it was being completed." };
  }

  await supabaseAdmin.from("drivers").update({ busy: false }).eq("id", trip.driver_id);

  const completionLabel =
    params.mode === "otp"
      ? "End OTP verified"
      : params.mode === "bypass"
        ? `Driver confirmed the trip ended and fare was received without End OTP: ${params.reason}`
        : `Completed by admin: ${String(params.note ?? "").trim()}`;
  await supabaseAdmin.from("trip_events").insert([
    {
      trip_id: params.tripId,
      event_type:
        params.mode === "otp"
          ? "end_otp_verified"
          : params.mode === "bypass"
            ? "end_otp_bypassed"
            : "trip_completed_admin",
      message: completionLabel,
      old_status: "ongoing",
      new_status: params.mode === "otp" ? "ongoing" : "completed",
      created_by: params.actorId,
    },
    {
      trip_id: params.tripId,
      event_type: "fare_finalized",
      message: `Final fare confirmed at R${fare.finalFare}.`,
      old_status: "ongoing",
      new_status: "ongoing",
      created_by: params.actorId,
    },
    {
      trip_id: params.tripId,
      event_type: "trip_completed",
      message: `${distanceAudit} ${completionLabel}.`,
      old_status: "ongoing",
      new_status: "completed",
      created_by: params.actorId,
    },
  ]);

  await Promise.all([
    notifyCustomerForTrip(
      params.tripId,
      "Trip completed",
      `Your trip is complete. Final fare: R${fare.finalFare.toFixed(2)}.`,
      `/ride/${params.tripId}`,
      { type: "trip_completed", tripId: params.tripId },
    ).catch(() => null),
    notifyDriverForTrip(
      params.tripId,
      params.mode === "admin" ? "Trip completed by MOOVU" : "Trip completed",
      `Trip complete. Final fare: R${fare.finalFare.toFixed(2)}.`,
      "/driver/history",
      { type: "trip_completed", tripId: params.tripId },
    ).catch(() => null),
    notifyAdmins(
      params.mode === "bypass" ? "Trip completed without End OTP" : "Trip completed",
      `Trip ${params.tripId} was completed. Final fare: R${fare.finalFare.toFixed(2)}.`,
      `/admin/trips/${params.tripId}`,
    ).catch(() => null),
  ]);

  return {
    ok: true,
    status: 200,
    message: "Trip completed successfully.",
    fare,
    commission: {
      skipped: commissionResult.skipped,
      fareAmount: commissionResult.calc.fareAmount,
      commissionPct: commissionResult.calc.commissionPct,
      commissionAmount: commissionResult.calc.commissionAmount,
      driverNet: commissionResult.calc.driverNet,
    },
    elapsedSeconds,
    minRequiredSeconds,
    distanceAudit,
    kmAway: kmAway == null ? null : Math.round(kmAway * 100) / 100,
  };
}
