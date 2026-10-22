import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { dispatchTrip } from "@/lib/dispatch/dispatchTrip";
import { enqueueDispatchJob } from "@/lib/dispatch/dispatchScheduler";
import { shouldDispatchPaidTrip } from "@/lib/payments/onlinePayment";

type ClaimRow = {
  outcome: "START" | "RECOVER" | "BUSY" | "DONE" | "NOT_READY" | "NOT_AUTHORITY" | "DEFERRED";
  trip_id: string | null;
  round_id: string | null;
  offer_id: string | null;
  accept_deadline_at: string | null;
  offer_cycle: number | null;
};

async function finish(paymentAttemptId: string, claimToken: string, success: boolean, reason?: string) {
  const { data, error } = await supabaseAdmin.rpc("finish_online_payment_dispatch", {
    p_attempt_id: paymentAttemptId,
    p_claim_token: claimToken,
    p_success: success,
    p_error: reason ?? null,
  });
  if (error) throw new Error("Payment dispatch acknowledgement failed.");
  return String(data);
}

export async function dispatchVerifiedOnlineTrip(paymentAttemptId: string) {
  const claimToken = crypto.randomUUID();
  const { data, error } = await supabaseAdmin.rpc("claim_online_payment_dispatch", {
    p_attempt_id: paymentAttemptId,
    p_token: claimToken,
    p_lease_seconds: 120,
  });
  // No fallback to the old claimless path: a missing migration must fail closed.
  if (error) throw new Error("Payment dispatch ownership is unavailable.");
  const claim = (Array.isArray(data) ? data[0] : data) as ClaimRow | null;
  if (!claim) throw new Error("Payment dispatch claim returned no outcome.");
  if (claim.outcome === "BUSY") return { ok: true, deferred: true, reason: "ALREADY_IN_PROGRESS" };
  if (claim.outcome === "DONE") return { ok: true, deferred: false, reason: "ALREADY_DISPATCHED" };
  if (claim.outcome === "DEFERRED") return { ok: true, deferred: true, reason: "SCHEDULED_TRIP" };
  if (claim.outcome === "NOT_AUTHORITY") {
    throw new Error("Another verified payment attempt owns this booking's dispatch.");
  }
  if (claim.outcome === "NOT_READY" || !claim.trip_id) {
    return { ok: false, deferred: false, reason: "PAYMENT_NOT_SUCCEEDED" };
  }

  if (claim.outcome === "RECOVER") {
    if (!claim.offer_id || !claim.accept_deadline_at) throw new Error("Paid offer recovery is incomplete.");
    const scheduled = await enqueueDispatchJob({
      supabase: supabaseAdmin,
      tripId: claim.trip_id,
      offerId: claim.offer_id,
      jobType: "expire",
      runAt: claim.accept_deadline_at,
      dispatchCycle: Math.max(1, Number(claim.offer_cycle ?? 1)),
      sequenceNumber: 1,
    });
    if (!scheduled.ok) throw new Error("Paid offer recovery could not queue expiry.");
    const acknowledged = await finish(paymentAttemptId, claimToken, true);
    if (acknowledged !== "DISPATCHED") throw new Error("Paid offer recovery lost ownership.");
    return { ok: true, deferred: false, reason: "EXISTING_OFFER_ROUND_RECOVERED" };
  }

  const { data: trip, error: tripError } = await supabaseAdmin
    .from("trips")
    .select("id,status,driver_id,ride_type")
    .eq("id", claim.trip_id)
    .maybeSingle();
  if (tripError || !trip) throw new Error("Paid trip could not be loaded.");
  if (!shouldDispatchPaidTrip({ ...trip, driverId: trip.driver_id, rideType: trip.ride_type, paymentState: "SUCCEEDED" })) {
    const acknowledged = await finish(paymentAttemptId, claimToken, true);
    if (acknowledged !== "DISPATCHED") throw new Error("Payment dispatch lost ownership.");
    return { ok: true, deferred: false, reason: "ALREADY_HANDLED_OR_NOT_DISPATCHABLE" };
  }

  const result = await dispatchTrip({
    tripId: trip.id,
    paymentDispatch: { attemptId: paymentAttemptId, claimToken },
  });
  if (result.ok && result.schedulerQueued === false) {
    throw new Error("Paid offer round needs expiry-job recovery.");
  }
  const acknowledged = await finish(paymentAttemptId, claimToken, result.ok, result.error);
  if (acknowledged === "STALE") throw new Error("Payment dispatch lost ownership.");
  if (!result.ok && acknowledged !== "DISPATCHED") throw new Error(result.error ?? "Paid trip dispatch failed.");
  return { ok: true, deferred: false, reason: acknowledged === "DISPATCHED" ? "DISPATCHED" : "FAILED" };
}
