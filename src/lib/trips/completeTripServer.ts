import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FinalFareBreakdown } from "@/lib/domain/fare";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";
import { callPhase2Rpc } from "@/lib/server/phase2Rpc";
import { phase2Mode } from "@/lib/finance/phase2Policy";
import {
  processPhase2ShadowRecoveryJob,
  type Phase2ShadowRecoveryJob,
} from "@/lib/finance/phase2ShadowRecovery";
import { isOutboxDeliveryEnabled } from "@/lib/notifications/outboxDelivery";
import { haversineKm, isFreshHeartbeat, minimumRequiredTripSeconds } from "@/lib/geo/tripGuards";
import { notifyAdmins, notifyCustomerForTrip, notifyDriverForTrip } from "@/lib/push-notify";
import {
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
  financial_version?: number | null;
  phase5_policy_version?: string | null;
  phase5_driver_fare_basis_cents?: number | null;
};

const COMPLETE_SELECT = `
  id,status,driver_id,fare_amount,duration_min,distance_km,dropoff_lat,dropoff_lng,
  start_otp_verified,end_otp,end_otp_verified,trip_started_at,ride_option,original_fare,final_add_stop_increase,
  stop_waiting_fee,final_fare,route_distance_km,route_duration_min,estimated_fare,
  actual_distance_km,actual_duration_min,financial_version,phase5_policy_version,phase5_driver_fare_basis_cents
`;

type AtomicCompletionResult = {
  trip_id: string;
  driver_id: string;
  fare_amount: number;
  commission_pct: number;
  commission_amount: number;
  driver_net: number;
  replayed: boolean;
};

async function postShadowTripCommission(tripId: string, actorId: string, legacyReplayed: boolean) {
  const sourceKey = `trip_commission:${tripId}`;
  try {
    const claim = await callPhase2Rpc<{ claimed: boolean; job?: Phase2ShadowRecoveryJob }>(
      supabaseAdmin,
      "phase2_claim_shadow_recovery_job",
      { p_operation_key: sourceKey },
    );
    if (!claim.ok || !claim.result.claimed || !claim.result.job) {
      if (!claim.ok) console.error("[phase2-finance] shadow recovery claim failed", {
        tripId, sourceKey, legacyReplayed, state: "unresolved", code: claim.code,
      });
      return;
    }
    const shadow = await processPhase2ShadowRecoveryJob(supabaseAdmin, {
      ...claim.result.job,
      actor_id: claim.result.job.actor_id ?? actorId,
    });
    if (!shadow.ok) {
      console.error("[phase2-finance] shadow trip posting requires reconciliation", {
        tripId, sourceKey, legacyReplayed, state: "unresolved", code: shadow.code, retryable: shadow.retryable,
      });
    } else {
      console.info("[phase2-finance] shadow trip posting reconciled", {
        tripId, sourceKey, legacyReplayed, state: "resolved", shadowReplayed: shadow.replayed,
      });
    }
  } catch {
    console.error("[phase2-finance] shadow trip posting requires reconciliation", {
      tripId, sourceKey, legacyReplayed, state: "unresolved", code: "transport_failure",
    });
  }
}

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
  | { ok: false; status: number; error: string; code?: string; referenceId?: string };

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
      if (phase2Mode() !== "OFF") {
        // Require the existing authorized completion event before repairing its shadow side effect.
        const replay = await callHardenedRpc<AtomicCompletionResult>(supabaseAdmin, "phase05b_complete_trip", {
          p_trip_id: params.tripId,
          p_actor_id: params.actorId,
          p_expected_driver_id: params.driverId ?? trip.driver_id,
          p_mode: params.mode,
          p_otp: params.otp?.trim() || null,
          p_reason: params.reason ?? null,
          p_note: params.note ?? null,
          p_expected_financial_version: Number(trip.financial_version ?? 0),
          p_expected_fare: trip.phase5_policy_version && trip.phase5_driver_fare_basis_cents
            ? trip.phase5_driver_fare_basis_cents / 100 : trip.final_fare ?? trip.fare_amount,
          p_distance_audit: "Completed trip shadow recovery.",
        });
        if (!replay.ok) return {
          ok: false, status: replay.status, error: replay.error,
          code: replay.code, referenceId: replay.referenceId,
        };
        if (replay.result.replayed === true) {
          if (phase2Mode() !== "OFF") await postShadowTripCommission(params.tripId, params.actorId, true);
        }
      }
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

  const phase5DriverFare = trip.phase5_policy_version && trip.phase5_driver_fare_basis_cents
    ? trip.phase5_driver_fare_basis_cents / 100
    : null;
  const lockedFare = buildLockedFareBreakdown(phase5DriverFare
    ? { finalFare: phase5DriverFare, fareAmount: phase5DriverFare, estimatedFare: phase5DriverFare, originalFare: phase5DriverFare }
    : {
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

  const financeMode = phase2Mode();
  const completed = await callHardenedRpc<AtomicCompletionResult>(supabaseAdmin, "phase05b_complete_trip", {
    p_trip_id: params.tripId,
    p_actor_id: params.actorId,
    p_expected_driver_id: params.driverId ?? trip.driver_id,
    p_mode: params.mode,
    p_otp: params.otp?.trim() || null,
    p_reason: params.reason ?? null,
    p_note: params.note ?? null,
    p_expected_financial_version: Number(trip.financial_version ?? 0),
    p_expected_fare: phase5DriverFare ?? fareAmount,
    p_distance_audit: distanceAudit,
  });
  if (!completed.ok) {
    return {
      ok: false,
      status: completed.status,
      error: completed.error,
      code: completed.code,
      referenceId: completed.referenceId,
    };
  }
  const commissionResult = completed.result;

  if (financeMode !== "OFF") {
    await postShadowTripCommission(params.tripId, params.actorId, commissionResult.replayed);
  }

  if (!commissionResult.replayed && !isOutboxDeliveryEnabled()) await Promise.all([
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
      skipped: commissionResult.replayed,
      fareAmount: Number(commissionResult.fare_amount),
      commissionPct: Number(commissionResult.commission_pct),
      commissionAmount: Number(commissionResult.commission_amount),
      driverNet: Number(commissionResult.driver_net),
    },
    elapsedSeconds,
    minRequiredSeconds,
    distanceAudit,
    kmAway: kmAway == null ? null : Math.round(kmAway * 100) / 100,
  };
}
