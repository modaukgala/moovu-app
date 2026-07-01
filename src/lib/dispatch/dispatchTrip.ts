import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushSafe } from "@/lib/push-server";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";
import { DISPATCH_CONFIG, dispatchRadiusForCycle } from "@/lib/dispatch/config";
import { getDispatchCandidates, getPreferredDispatchCandidate } from "@/lib/dispatch/dispatchCandidates";
import { dispatchJobsQueued, enqueueDispatchJob } from "@/lib/dispatch/dispatchScheduler";
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
    .select("id,status,driver_id,pickup_address,dropoff_address,pickup_lat,pickup_lng,ride_option,dispatch_started_at,dispatch_cycle")
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
    .eq("trip_id", trip.id)
    .in("status", ["pending", "shown"])
    .lte("accept_deadline_at", expiryNow);

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

  const startedAtMs = trip.dispatch_started_at ? new Date(trip.dispatch_started_at).getTime() : Date.now();
  if (Date.now() - startedAtMs > DISPATCH_CONFIG.maxSearchSeconds * 1000 || cycle > DISPATCH_CONFIG.maxCycles) {
    console.warn("[dispatch] search exhausted", {
      tripId: trip.id,
      cycle,
      startedAt: trip.dispatch_started_at,
    });
    try {
      await supabaseAdmin.rpc("mark_dispatch_exhausted", { p_trip_id: trip.id });
    } catch {}
    await notifyCustomerForTrip(
      trip.id,
      "Nearby drivers are unavailable",
      "We could not find an available driver yet. You can keep the request open or try again shortly.",
      `/ride/${trip.id}`,
    ).catch(() => null);
    await notifyAdmins("Dispatch needs attention", `No eligible driver accepted trip ${trip.id}.`, "/admin/dispatch").catch(() => null);
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
    if (nextCycle <= DISPATCH_CONFIG.maxCycles) {
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
        runAt: new Date(Date.now() + DISPATCH_CONFIG.cycleCooldownSeconds * 1000).toISOString(),
        dispatchCycle: nextCycle,
        sequenceNumber: 1,
      });
    }
    return { ok: false, tripId: trip.id, exhausted: nextCycle > DISPATCH_CONFIG.maxCycles, error: "No eligible drivers available." };
  }

  let row: AtomicOfferRow | null = null;
  let reservationError: string | null = null;
  for (const candidate of candidatesToTry) {
    const { data, error } = await supabaseAdmin.rpc("reserve_trip_offer", {
      p_trip_id: trip.id,
      p_driver_id: candidate.driverId,
      p_dispatch_cycle: cycle,
      p_sequence_number: sequenceNumber,
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
      reservationError = error.message;
      console.warn("[dispatch] reserve_trip_offer rejected candidate", {
        tripId: trip.id,
        driverId: candidate.driverId,
        cycle,
        sequenceNumber,
        reason: error.message,
      });
      if (params.preferredDriverId || error.code !== "P0001") break;
      continue;
    }

    row = (Array.isArray(data) ? data[0] : data) as AtomicOfferRow | null;
    if (row?.offer_id) break;
  }

  if (!row?.offer_id && reservationError) {
    console.error("[dispatch] reservation failed for all candidates", {
      tripId: trip.id,
      cycle,
      sequenceNumber,
      reason: reservationError,
    });
    return { ok: false, tripId: trip.id, error: reservationError };
  }
  if (!row?.offer_id) return { ok: false, tripId: trip.id, error: "Offer reservation was not created." };

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

  const schedulerResults = await Promise.all([
    enqueueDispatchJob({
      supabase: supabaseAdmin,
      tripId: trip.id,
      offerId: row.offer_id,
      jobType: "escalate",
      runAt: row.escalates_at,
      dispatchCycle: cycle,
      sequenceNumber,
    }),
    enqueueDispatchJob({
      supabase: supabaseAdmin,
      tripId: trip.id,
      offerId: row.offer_id,
      jobType: "expire",
      runAt: row.accept_deadline_at,
      dispatchCycle: cycle,
      sequenceNumber,
    }),
  ]);
  const schedulerQueued = dispatchJobsQueued(schedulerResults);
  const schedulerWarning = schedulerQueued
    ? undefined
    : "The first offer was sent, but dispatch escalation requires worker attention.";

  if (!schedulerQueued) {
    console.error("[dispatch] offer created without complete scheduler jobs", {
      tripId: trip.id,
      offerId: row.offer_id,
      driverId: row.driver_id,
      schedulerResults,
    });
    await notifyAdmins(
      "Dispatch scheduler needs attention",
      `Trip ${trip.id} was offered, but its escalation or expiry job could not be queued.`,
      "/admin/dispatch",
    ).catch(() => null);
  }

  console.log("[dispatch] driver offered", {
    tripId: trip.id,
    offerId: row.offer_id,
    driverId: row.driver_id,
    cycle,
    sequenceNumber,
    expiresAt: row.accept_deadline_at,
    escalatesAt: row.escalates_at,
  });

  await notifyDriverOffer({
    tripId: trip.id,
    driverId: row.driver_id,
    pickup: trip.pickup_address,
    destination: trip.dropoff_address,
  }).catch((notificationError: unknown) => {
    console.error("[dispatch] offer notification failed", {
      tripId: trip.id,
      driverId: row.driver_id,
      reason: notificationError instanceof Error ? notificationError.message : "Unknown push error",
    });
  });

  return {
    ok: true,
    tripId: trip.id,
    offerId: row.offer_id,
    driverId: row.driver_id,
    expiresAt: row.accept_deadline_at,
    escalatesAt: row.escalates_at,
    mode: "atomic",
    schedulerQueued,
    schedulerWarning,
  };
}
