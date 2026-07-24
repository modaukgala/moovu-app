import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushSafe } from "@/lib/push-server";
import { notifyAdmins } from "@/lib/push-notify";
import { DISPATCH_CONFIG, dispatchRadiusForCycle, isDispatchExpired } from "@/lib/dispatch/config";
import { getDispatchCandidates, getPreferredDispatchCandidate } from "@/lib/dispatch/dispatchCandidates";
import { enqueueDispatchJob } from "@/lib/dispatch/dispatchScheduler";
import { cancelExpiredDispatch } from "@/lib/dispatch/cancelExpiredDispatch";
import type { DispatchResult } from "@/lib/dispatch/types";

type AtomicOfferRow = {
  offer_id: string;
  driver_id: string;
  accept_deadline_at: string;
  escalates_at: string;
};

function isMissingAtomicDispatch(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "PGRST202" || message.includes("reserve_trip_offer") || message.includes("dispatch_jobs");
}

function isDispatchSchemaHotfixRequired(error: { message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("driver_id") && message.includes("ambiguous");
}

async function notifyDriverOffer(params: {
  tripId: string;
  driverId: string;
  pickup: string | null;
  destination: string | null;
}) {
  const { data: account } = await supabaseAdmin
    .from("driver_accounts")
    .select("user_id")
    .eq("driver_id", params.driverId)
    .maybeSingle();

  if (!account?.user_id) {
    console.error("[dispatch] driver offer notification target missing", {
      tripId: params.tripId,
      driverId: params.driverId,
    });
    return;
  }
  const result = await sendPushSafe({
    userIds: [account.user_id],
    role: "driver",
    title: "New trip nearby",
    body: `Pickup at ${params.pickup ?? "pickup"} to ${params.destination ?? "destination"}.`,
    url: `/driver?offerTripId=${params.tripId}`,
    data: {
      nativeActionType: "trip_offer",
      tripId: params.tripId,
      driverId: params.driverId,
    },
  });
  console.info("[dispatch] driver offer notification result", {
    tripId: params.tripId,
    driverId: params.driverId,
    userId: account.user_id,
    delivered: result.delivered,
    failed: result.failed,
    removed: result.removed,
    ok: result.ok,
  });
}

export async function dispatchTrip(params: {
  tripId: string;
  cycle?: number;
  sequenceNumber?: number;
  preferredDriverId?: string | null;
}): Promise<DispatchResult> {
  const cycle = Math.max(1, params.cycle ?? 1);
  const sequenceNumber = Math.max(1, params.sequenceNumber ?? 1);
  console.log("[dispatch] trip dispatch requested", {
    tripId: params.tripId,
    cycle,
    sequenceNumber,
    preferredDriverId: params.preferredDriverId ?? null,
  });
  const { data: trip, error: tripError } = await supabaseAdmin
    .from("trips")
    .select("id,status,driver_id,pickup_address,dropoff_address,pickup_lat,pickup_lng,ride_option,created_at,dispatch_started_at,dispatch_cycle")
    .eq("id", params.tripId)
    .maybeSingle();

  if (tripError || !trip) {
    return { ok: false, tripId: params.tripId, error: tripError?.message ?? "Trip not found." };
  }
  if (!["requested", "offered"].includes(String(trip.status))) {
    return { ok: false, tripId: trip.id, error: "Trip is no longer dispatchable." };
  }
  if (trip.driver_id && trip.status !== "offered") {
    return { ok: false, tripId: trip.id, error: "Trip already has a driver." };
  }
  if (trip.pickup_lat == null || trip.pickup_lng == null) {
    return { ok: false, tripId: trip.id, error: "Trip pickup coordinates are missing." };
  }

  const expiryNow = new Date().toISOString();
  const { error: staleOfferError } = await supabaseAdmin
    .from("driver_trip_offers")
    .update({
      status: "expired",
      updated_at: expiryNow,
    })
    .in("status", ["pending", "shown"])
    .or(`accept_deadline_at.lte.${expiryNow},accept_deadline_at.is.null`);

  if (staleOfferError) {
    console.error("[dispatch] stale offer cleanup failed", {
      tripId: trip.id,
      reason: staleOfferError.message,
    });
    return {
      ok: false,
      tripId: trip.id,
      error: "Could not clear the expired offer. Please retry in a moment.",
    };
  }

  if (isDispatchExpired(trip.created_at) || cycle > DISPATCH_CONFIG.maxCycles) {
    console.warn("[dispatch] search exhausted", {
      tripId: trip.id,
      cycle,
      startedAt: trip.dispatch_started_at,
    });
    await cancelExpiredDispatch(trip.id);
    return { ok: false, tripId: trip.id, exhausted: true, error: "Dispatch search exhausted." };
  }

  const radiusKm = dispatchRadiusForCycle(cycle);
  let candidates;
  try {
    if (params.preferredDriverId) {
      const preferred = await getPreferredDispatchCandidate({
        supabase: supabaseAdmin,
        tripId: trip.id,
        driverId: params.preferredDriverId,
        pickupLat: Number(trip.pickup_lat),
        pickupLng: Number(trip.pickup_lng),
        rideOption: trip.ride_option,
      });
      candidates = preferred.ok ? [preferred.candidate] : [];
      if (!preferred.ok) {
        console.warn("[dispatch] preferred driver not eligible", {
          tripId: trip.id,
          driverId: params.preferredDriverId,
          reason: preferred.error,
        });
        return { ok: false, tripId: trip.id, error: preferred.error };
      }
    } else {
      candidates = await getDispatchCandidates({
        supabase: supabaseAdmin,
        tripId: trip.id,
        pickupLat: Number(trip.pickup_lat),
        pickupLng: Number(trip.pickup_lng),
        rideOption: trip.ride_option,
        radiusKm,
      });
    }
  } catch (error: unknown) {
    console.error("[dispatch] candidate lookup failed", {
      tripId: trip.id,
      cycle,
      sequenceNumber,
      reason: error instanceof Error ? error.message : "Unknown error",
    });
    return { ok: false, tripId: trip.id, error: error instanceof Error ? error.message : "Candidate lookup failed." };
  }

  const candidatesToTry = params.preferredDriverId
    ? candidates.filter((row) => row.driverId === params.preferredDriverId)
    : candidates;

  console.log("[dispatch] candidates prepared", {
    tripId: trip.id,
    cycle,
    sequenceNumber,
    radiusKm,
    candidateCount: candidates.length,
    targetedCount: candidatesToTry.length,
  });

  if (candidatesToTry.length === 0) {
    const nextCycle = cycle + 1;
    if (!isDispatchExpired(trip.created_at) && nextCycle <= DISPATCH_CONFIG.maxCycles) {
      console.log("[dispatch] no candidates, scheduling recover", {
        tripId: trip.id,
        currentCycle: cycle,
        nextCycle,
        cooldownSeconds: DISPATCH_CONFIG.cycleCooldownSeconds,
      });
      await enqueueDispatchJob({
        supabase: supabaseAdmin,
        tripId: trip.id,
        jobType: "recover",
        runAt: new Date(Date.now() + DISPATCH_CONFIG.acceptWindowSeconds * 1000).toISOString(),
        dispatchCycle: nextCycle,
        sequenceNumber: 1,
      });
    }
    return { ok: false, tripId: trip.id, exhausted: nextCycle > DISPATCH_CONFIG.maxCycles, error: "No eligible drivers available." };
  }

  const rows: AtomicOfferRow[] = [];
  const reservationErrors: string[] = [];
  for (const [candidateIndex, candidate] of candidatesToTry.entries()) {
    const { data, error } = await supabaseAdmin.rpc("reserve_trip_offer", {
      p_trip_id: trip.id,
      p_driver_id: candidate.driverId,
      p_dispatch_cycle: cycle,
      p_sequence_number: sequenceNumber + candidateIndex,
      p_distance_km: candidate.distanceKm,
      p_road_eta_seconds: candidate.roadEtaSeconds,
      p_dispatch_score: candidate.score,
      p_score_breakdown: candidate.scoreBreakdown,
      p_escalation_seconds: DISPATCH_CONFIG.escalationSeconds,
      p_accept_window_seconds: DISPATCH_CONFIG.acceptWindowSeconds,
      p_search_radius_km: radiusKm,
    });

    if (error) {
      if (isMissingAtomicDispatch(error)) {
        console.error("[dispatch] atomic offer reservation unavailable", {
          tripId: trip.id,
          driverId: candidate.driverId,
          cycle,
          sequenceNumber,
          reason: error.message,
        });
        return { ok: false, tripId: trip.id, error: "Atomic dispatch migration is not active." };
      }
      if (isDispatchSchemaHotfixRequired(error)) {
        console.error("[dispatch] atomic offer reservation needs SQL hotfix", {
          tripId: trip.id,
          driverId: candidate.driverId,
          cycle,
          sequenceNumber,
          reason: error.message,
        });
        return { ok: false, tripId: trip.id, error: "Dispatch database needs the latest driver assignment SQL hotfix." };
      }
      reservationErrors.push(error.message);
      console.warn("[dispatch] reserve_trip_offer rejected candidate", {
        tripId: trip.id,
        driverId: candidate.driverId,
        cycle,
        sequenceNumber,
        reason: error.message,
      });
      if (params.preferredDriverId || error.code !== "P0001") {
        if (params.preferredDriverId) break;
      }
      continue;
    }

    const row = (Array.isArray(data) ? data[0] : data) as AtomicOfferRow | null;
    if (row?.offer_id) rows.push(row);
  }

  if (rows.length === 0 && reservationErrors.length > 0) {
    console.error("[dispatch] reservation failed for all candidates", {
      tripId: trip.id,
      cycle,
      sequenceNumber,
      reason: reservationErrors[0],
    });
    return { ok: false, tripId: trip.id, error: reservationErrors[0] };
  }
  if (rows.length === 0) return { ok: false, tripId: trip.id, error: "Offer reservation was not created." };

  if (cycle > 1 && sequenceNumber === 1) {
    try {
      await supabaseAdmin.from("trip_events").insert({
        trip_id: trip.id,
        event_type: "offer_cycle_restarted",
        message: `Dispatch restarted for cycle ${cycle}.`,
        old_status: "requested",
        new_status: "offered",
      });
    } catch {}
  }

  const firstRow = rows[0];
  const schedulerResult = await enqueueDispatchJob({
    supabase: supabaseAdmin,
    tripId: trip.id,
    offerId: firstRow.offer_id,
    jobType: "expire",
    runAt: firstRow.accept_deadline_at,
    dispatchCycle: cycle,
    sequenceNumber: 1,
  });
  const schedulerQueued = schedulerResult.ok;
  const schedulerWarning = schedulerQueued
    ? undefined
    : "The offer round was sent, but its next 30-second dispatch step requires worker attention.";

  if (!schedulerQueued) {
    console.error("[dispatch] offer created without complete scheduler jobs", {
      tripId: trip.id,
      offerIds: rows.map((row) => row.offer_id),
      driverIds: rows.map((row) => row.driver_id),
      schedulerResult,
    });
    await notifyAdmins(
      "Dispatch scheduler needs attention",
      `Trip ${trip.id} was offered to ${rows.length} drivers, but its next round could not be queued.`,
      "/admin/dispatch",
    ).catch(() => null);
  }

  console.log("[dispatch] offer round created", {
    tripId: trip.id,
    offerIds: rows.map((row) => row.offer_id),
    driverIds: rows.map((row) => row.driver_id),
    offerCount: rows.length,
    cycle,
    expiresAt: firstRow.accept_deadline_at,
  });

  await Promise.allSettled(
    rows.map((row) =>
      notifyDriverOffer({
        tripId: trip.id,
        driverId: row.driver_id,
        pickup: trip.pickup_address,
        destination: trip.dropoff_address,
      }),
    ),
  );

  return {
    ok: true,
    tripId: trip.id,
    offerId: firstRow.offer_id,
    driverId: firstRow.driver_id,
    offerIds: rows.map((row) => row.offer_id),
    driverIds: rows.map((row) => row.driver_id),
    offerCount: rows.length,
    expiresAt: firstRow.accept_deadline_at,
    escalatesAt: firstRow.escalates_at,
    mode: "atomic",
    schedulerQueued,
    schedulerWarning,
  };
}
