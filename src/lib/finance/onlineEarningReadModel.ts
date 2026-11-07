import type { SupabaseClient } from "@supabase/supabase-js";
// @ts-expect-error Node strip-types tests require the explicit extension.
import { presentCompletedOnlineEarning, type CompletedOnlineTrip, type FeeComponents, type MatchedOnlinePayment } from "./onlineEarningPresentation.ts";

/** Read-only financial cards for completed trips that have no posted payable yet. */
export async function loadUnpostedOnlineEarnings(
  client: SupabaseClient, payoutCutoff: string, optionBCutoff: string | null, driverId?: string,
) {
  let tripQuery = client.from("trips")
    .select("id,driver_id,completed_at,ride_option,phase5_policy_version,phase5_driver_fare_basis_cents,phase5_customer_total_cents,phase5_service_fee_cents,phase5_membership_waiver_cents,phase5_credit_cents,commission_amount,final_fare,fare_amount")
    .eq("status", "completed").eq("payment_method", "online")
    .gte("completed_at", payoutCutoff).order("completed_at", { ascending: false }).limit(101);
  if (driverId) tripQuery = tripQuery.eq("driver_id", driverId);
  const trips = await tripQuery;
  if (trips.error || !trips.data || trips.data.length > 100) throw new Error("Completed online earnings require paginated review.");
  if (trips.data.length === 0) return [];
  const tripIds = trips.data.map(row => row.id);
  const [attempts, payables] = await Promise.all([
    client.from("online_payment_attempts")
      .select("id,trip_id,amount_cents,state,reconciliation_state,verified_at,payment_ledger_transaction_id,created_at")
      .in("trip_id", tripIds).eq("state", "SUCCEEDED").order("created_at", { ascending: false }),
    client.from("online_driver_payables").select("trip_id").in("trip_id", tripIds),
  ]);
  if (attempts.error || payables.error || !attempts.data || !payables.data) {
    throw new Error("Online earning authority is unavailable.");
  }
  const postedTripIds = new Set(payables.data.map(row => row.trip_id));
  const latestAttempt = new Map<string, MatchedOnlinePayment>();
  for (const row of attempts.data) if (!latestAttempt.has(row.trip_id)) latestAttempt.set(row.trip_id, row);
  const attemptIds = [...latestAttempt.values()].map(row => row.id);
  const refunds = attemptIds.length ? await client.from("online_payment_refunds")
    .select("payment_attempt_id,state").in("payment_attempt_id", attemptIds) : { data: [], error: null };
  if (refunds.error || !refunds.data) throw new Error("Refund state is unavailable.");
  const affectedAttempts = new Set(refunds.data.filter(row => row.state !== "REFUND_FAILED")
    .map(row => row.payment_attempt_id));
  const evidence = optionBCutoff && attemptIds.length ? await client.from("online_payout_fee_evidence")
    .select("payment_attempt_id,actual_fee_cents,percentage_fee_cents,fixed_fee_cents,source_type,source_reference")
    .in("payment_attempt_id", attemptIds) : { data: [], error: null };
  if (evidence.error || !evidence.data) throw new Error("Provider fee evidence is unavailable.");
  const evidenceByAttempt = new Map((evidence.data as FeeComponents[])
    .map(row => [row.payment_attempt_id, row]));
  return (trips.data as CompletedOnlineTrip[])
    .filter(trip => !postedTripIds.has(trip.id))
    .map(trip => {
      const attempt = latestAttempt.get(trip.id);
      return affectedAttempts.has(attempt?.id ?? "") ? null : presentCompletedOnlineEarning(
        trip, attempt, evidenceByAttempt.get(attempt?.id ?? ""), optionBCutoff);
    }).filter(row => row !== null);
}
