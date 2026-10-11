import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDispatchCandidates, getPreferredDispatchCandidate } from "@/lib/dispatch/dispatchCandidates";
import { enqueueDispatchJob } from "@/lib/dispatch/dispatchScheduler";
import { expireTripOffers } from "@/lib/dispatch/expireTripOffers";
import { notifyDriverOffer } from "@/lib/dispatch/notifyDriverOffer";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";
import { DISPATCHABLE_TRIP_STATUSES } from "@/lib/trips/tripContract";
import type { DispatchResult } from "@/lib/dispatch/types";
import { MATCHING_WINDOW_MS, matchingRadiusKm, matchingStep, nextMatchingStepAt } from "@/lib/dispatch/matchingWindowPolicy";

const OFFER_SECONDS = 25;

type MatchingWindow = { started_at: string; deadline_at: string; state: string; payment_attempt_id: string | null };
type Offer = { offer_id: string; driver_id: string; accept_deadline_at: string; escalates_at: string };

async function queueNext(tripId: string, step: number, runAtMs: number) {
  // Each time slot has one durable job identity. A replay cannot multiply jobs.
  return enqueueDispatchJob({
    supabase: supabaseAdmin,
    tripId,
    jobType: "recover",
    runAt: new Date(runAtMs).toISOString(),
    dispatchCycle: 1,
    sequenceNumber: Math.max(1, step + 1),
  });
}

async function finishIfUnmatched(tripId: string): Promise<DispatchResult> {
  const { data, error } = await supabaseAdmin.rpc("finish_dispatch_matching_window", { p_trip_id: tripId });
  if (error) return { ok: false, tripId, error: error.message };
  const outcome = data as { changed?: boolean; replayed?: boolean; reason?: string } | null;
  if (outcome?.changed) {
    // The transaction already persisted the terminal state and, for paid trips,
    // the open reconciliation obligation. Notification is a separate effect.
    await Promise.allSettled([
      notifyCustomerForTrip(tripId, "No Driver accepted your trip",
        "We could not find a Driver. If you paid online, your refund needs reconciliation.", `/ride/${tripId}`),
      notifyAdmins("Trip matching ended", `Trip ${tripId} needs no-Driver review.`, `/admin/trips/${tripId}`),
    ]);
    return { ok: false, tripId, exhausted: true, error: "Matching window ended without a Driver." };
  }
  if (outcome?.replayed) return { ok: false, tripId, exhausted: true, error: "Matching already ended." };
  return { ok: false, tripId, error: outcome?.reason ?? "Matching closure was deferred." };
}

export async function dispatchTrip90s(params: {
  tripId: string;
  preferredDriverId?: string | null;
}): Promise<DispatchResult> {
  const { data: trip, error: tripError } = await supabaseAdmin.from("trips")
    .select("id,status,driver_id,pickup_address,dropoff_address,pickup_lat,pickup_lng,ride_option")
    .eq("id", params.tripId).maybeSingle();
  if (tripError || !trip) return { ok: false, tripId: params.tripId, error: tripError?.message ?? "Trip not found." };
  if (!(DISPATCHABLE_TRIP_STATUSES as readonly string[]).includes(String(trip.status)) || trip.driver_id) {
    return { ok: false, tripId: trip.id, exhausted: true, error: "Trip no longer awaits matching." };
  }
  if (trip.pickup_lat == null || trip.pickup_lng == null) {
    return { ok: false, tripId: trip.id, error: "Trip pickup coordinates are missing." };
  }

  const { data: rawWindow, error: windowError } = await supabaseAdmin.rpc("start_dispatch_matching_window", { p_trip_id: trip.id });
  if (windowError || !rawWindow) return { ok: false, tripId: trip.id, error: windowError?.message ?? "Matching authority unavailable." };
  const window = rawWindow as MatchingWindow;
  if (window.state !== "SEARCHING") return { ok: false, tripId: trip.id, exhausted: true, error: "Matching already ended." };
  const startedAtMs = new Date(window.started_at).getTime();
  const deadlineMs = new Date(window.deadline_at).getTime();
  if (!Number.isFinite(startedAtMs) || deadlineMs - startedAtMs !== MATCHING_WINDOW_MS) {
    return { ok: false, tripId: trip.id, error: "Invalid authoritative matching window." };
  }

  const now = Date.now();
  const { error: expiryError } = await expireTripOffers(supabaseAdmin, trip.id, new Date(now).toISOString());
  if (expiryError) return { ok: false, tripId: trip.id, error: "Expired offer cleanup failed." };
  const step = matchingStep(startedAtMs, now);
  if (now >= deadlineMs) {
    const { data: active, error: activeError } = await supabaseAdmin.from("driver_trip_offers")
      .select("accept_deadline_at").eq("trip_id", trip.id).in("status", ["pending", "shown"])
      .gt("accept_deadline_at", new Date(now).toISOString());
    if (activeError) return { ok: false, tripId: trip.id, error: "Outstanding offer check failed." };
    if (active?.length) {
      const latestDeadline = Math.max(...active.map(row => new Date(row.accept_deadline_at).getTime()));
      const queued = await queueNext(trip.id, step, Math.max(now + 1000, latestDeadline + 250));
      return { ok: queued.ok, tripId: trip.id, schedulerQueued: queued.ok,
        schedulerWarning: queued.ok ? undefined : queued.error };
    }
    return finishIfUnmatched(trip.id);
  }

  const nextStepAt = nextMatchingStepAt(startedAtMs, now);
  const queued = await queueNext(trip.id, step, nextStepAt);
  if (!queued.ok) return { ok: false, tripId: trip.id, error: queued.error };

  // This is the database-guarded single offer for the current ten-second slot.
  const { data: existing, error: existingError } = await supabaseAdmin.from("driver_trip_offers")
    .select("id,driver_id,accept_deadline_at,escalates_at")
    .eq("trip_id", trip.id).eq("matching_step", step).maybeSingle();
  if (existingError) return { ok: false, tripId: trip.id, error: existingError.message };
  if (existing) return { ok: true, tripId: trip.id, offerId: existing.id, driverId: existing.driver_id,
    offerCount: 1, schedulerQueued: true, mode: "atomic" };

  const radiusKm = matchingRadiusKm(step, Boolean(window.payment_attempt_id));
  let candidates;
  try {
    candidates = params.preferredDriverId
      ? await getPreferredDispatchCandidate({ supabase: supabaseAdmin, tripId: trip.id,
        driverId: params.preferredDriverId, pickupLat: Number(trip.pickup_lat),
        pickupLng: Number(trip.pickup_lng), rideOption: trip.ride_option, cycle: step + 1 })
        .then(result => result.ok ? [result.candidate] : [])
      : await getDispatchCandidates({ supabase: supabaseAdmin, tripId: trip.id,
        pickupLat: Number(trip.pickup_lat), pickupLng: Number(trip.pickup_lng),
        rideOption: trip.ride_option, radiusKm, cycle: step + 1, ranking: "nearest" });
  } catch {
    return { ok: false, tripId: trip.id, error: "Driver eligibility lookup failed." };
  }
  if (candidates.length === 0) return { ok: true, tripId: trip.id, offerCount: 0, schedulerQueued: true };

  for (const candidate of candidates) {
    const { data, error } = await supabaseAdmin.rpc("reserve_trip_offer", {
      p_trip_id: trip.id, p_driver_id: candidate.driverId, p_dispatch_cycle: step + 1,
      p_sequence_number: 1, p_distance_km: candidate.distanceKm,
      p_road_eta_seconds: candidate.roadEtaSeconds, p_dispatch_score: candidate.score,
      p_score_breakdown: candidate.scoreBreakdown, p_escalation_seconds: 10,
      p_accept_window_seconds: OFFER_SECONDS, p_search_radius_km: radiusKm,
    });
    if (error) {
      if (error.code === "23505") {
        const { data: winner } = await supabaseAdmin.from("driver_trip_offers")
          .select("id,driver_id").eq("trip_id", trip.id).eq("matching_step", step).maybeSingle();
        if (winner) return { ok: true, tripId: trip.id, offerId: winner.id,
          driverId: winner.driver_id, offerCount: 1, schedulerQueued: true };
      }
      if (error.code === "P0001") continue;
      return { ok: false, tripId: trip.id, error: error.message };
    }
    const offer = (Array.isArray(data) ? data[0] : data) as Offer | null;
    if (!offer) continue;
    const expiryJob = await enqueueDispatchJob({ supabase: supabaseAdmin, tripId: trip.id,
      offerId: offer.offer_id, jobType: "expire", runAt: offer.accept_deadline_at,
      dispatchCycle: step + 1, sequenceNumber: 1 });
    if (!expiryJob.ok) console.error("[dispatch] 90-second offer expiry job not queued", { tripId: trip.id });
    await notifyDriverOffer({ tripId: trip.id, driverId: offer.driver_id,
      pickup: trip.pickup_address, destination: trip.dropoff_address }).catch(() => null);
    return { ok: true, tripId: trip.id, offerId: offer.offer_id, driverId: offer.driver_id,
      offerCount: 1, expiresAt: offer.accept_deadline_at, escalatesAt: offer.escalates_at,
      mode: "atomic", schedulerQueued: expiryJob.ok,
      schedulerWarning: expiryJob.ok ? undefined : expiryJob.error };
  }
  return { ok: true, tripId: trip.id, offerCount: 0, schedulerQueued: true };
}
