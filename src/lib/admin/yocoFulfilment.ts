import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkValues, collectBoundedPages } from "./boundedRetrieval";

export const fulfilmentKinds = ["reconciliation", "cancelled", "missing_trip", "dispatch_failed", "deferred", "unavailable", "awaiting_acceptance", "normal"] as const;
type Kind = typeof fulfilmentKinds[number];
type Attempt = {
  id: string; trip_id: string | null; customer_id: string; state: string; verified_at: string | null;
  provider_payment_id: string | null; currency: string; amount_cents: number; dispatch_state: string | null;
  reconciliation_state: string | null;
};

export function classifyFulfilment(attempt: Attempt, evidence: {
  verified: boolean | null; trip: { status: string; offer_status: string | null } | null | undefined;
  issues: string[] | null; refunds: string[] | null;
}) {
  const indicators = new Set<Kind>();
  const { trip, issues, refunds } = evidence;
  if (evidence.verified === null) indicators.add("unavailable");
  if (evidence.verified) {
    if (attempt.reconciliation_state === "RECONCILIATION_REQUIRED" || issues?.length) indicators.add("reconciliation");
    if (issues === null || refunds === null || trip === undefined) indicators.add("unavailable");
    if (trip === null) indicators.add("missing_trip");
    if (trip?.status === "cancelled" && attempt.state !== "REFUNDED") indicators.add("cancelled");
    if (trip && !["completed", "cancelled", "ongoing", "arrived"].includes(trip.status)) {
      if (attempt.dispatch_state === "FAILED") indicators.add("dispatch_failed");
      if (attempt.dispatch_state === "DEFERRED") indicators.add("deferred");
      if (["requested", "offered", "assigned"].includes(trip.status) && trip.offer_status !== "accepted") indicators.add("awaiting_acceptance");
      if (!attempt.dispatch_state && trip.offer_status !== "accepted") indicators.add("unavailable");
    }
  }
  const reasons = fulfilmentKinds.filter((kind) => indicators.has(kind));
  const actionable = evidence.verified === true && reasons.some((kind) =>
    ["reconciliation", "cancelled", "missing_trip", "dispatch_failed", "deferred"].includes(kind));
  return { primary: reasons[0] ?? (evidence.verified ? "normal" : null), reasons, actionable };
}

export async function readYocoFulfilment(db: SupabaseClient) {
  const attempts = await collectBoundedPages<Attempt>({
    pageSize: 200, maxRows: 2000, load: async (from, to) => {
      const result = await db.from("online_payment_attempts")
        .select("id,trip_id,customer_id,state,verified_at,provider_payment_id,currency,amount_cents,dispatch_state,reconciliation_state")
        .eq("provider", "YOCO").order("verified_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false }).range(from, to);
      if (result.error || !result.data) throw new Error("Payment attempts unavailable.");
      return result.data;
    },
  });
  const rows = [];
  const seen = new Set<string>();
  let complete = attempts.complete;
  for (const group of chunkValues(attempts.rows, 100)) {
    const ids = group.map((row) => row.id);
    const tripIds = [...new Set(group.flatMap((row) => row.trip_id ? [row.trip_id] : []))];
    const [events, trips, issues, refunds] = await Promise.all([
      db.from("online_provider_events").select("payment_attempt_id", { count: "exact" }).in("payment_attempt_id", ids)
        .eq("provider", "YOCO").eq("trust_state", "VERIFIED").eq("processing_state", "PROCESSED").eq("raw_provider_status", "succeeded"),
      tripIds.length ? db.from("trips").select("id,status,offer_status").in("id", tripIds) : { data: [], error: null },
      db.from("online_payment_reconciliation_items").select("id,payment_attempt_id,issue_type", { count: "exact" })
        .in("payment_attempt_id", ids).eq("state", "OPEN"),
      db.from("online_payment_refunds").select("id,payment_attempt_id,state", { count: "exact" })
        .in("payment_attempt_id", ids).eq("provider", "YOCO"),
    ]);
    const usable = (result: { error: unknown; count: number | null; data: unknown[] | null }) =>
      !result.error && result.count != null && result.count === result.data?.length;
    const eventsAvailable = usable(events);
    const issuesAvailable = usable(issues);
    const refundsAvailable = usable(refunds);
    if (!eventsAvailable || trips.error || !issuesAvailable || !refundsAvailable) complete = false;
    for (const attempt of group) {
      const eligible = ["SUCCEEDED", "RECONCILIATION_REQUIRED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED", "REFUND_FAILED"].includes(attempt.state)
        && !!attempt.verified_at && !!attempt.provider_payment_id && attempt.currency === "ZAR" && attempt.amount_cents > 0;
      const verified = eligible ? eventsAvailable && events.data?.some((row) => row.payment_attempt_id === attempt.id) ? true : null : false;
      if (verified === null && eligible) complete = false;
      const key = verified ? attempt.provider_payment_id! : attempt.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const trip = attempt.trip_id ? trips.error ? undefined : trips.data?.find((row) => row.id === attempt.trip_id) ?? null : null;
      const matchedIssues = issuesAvailable ? (issues.data ?? []).filter((row) => row.payment_attempt_id === attempt.id) : null;
      const matchedRefunds = refundsAvailable ? (refunds.data ?? []).filter((row) => row.payment_attempt_id === attempt.id) : null;
      const classification = classifyFulfilment(attempt, { verified, trip, issues: matchedIssues?.map((row) => row.issue_type) ?? null,
        refunds: matchedRefunds?.map((row) => row.state) ?? null });
      if (classification.reasons.includes("unavailable")) complete = false;
      rows.push({ ...attempt, verified, tripStatus: trip?.status ?? null, tripAvailable: !!trip,
        tripEvidence: trip === undefined ? "unavailable" : trip === null ? "missing" : "loaded",
        issues: matchedIssues, refunds: matchedRefunds,
        ...classification,
      });
    }
  }
  return { rows, complete, count: complete ? rows.filter((row) => row.actionable).length : null };
}
