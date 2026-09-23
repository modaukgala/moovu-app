import type { SupabaseClient } from "@supabase/supabase-js";

export type OfferAttempt = { driver_id: string; status: string; dispatch_cycle: number | null };

export async function readOfferAttempts(supabase: SupabaseClient, tripId: string, driverIds: string[]) {
  const data: OfferAttempt[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await supabase.from("driver_trip_offers").select("driver_id,status,dispatch_cycle")
      .eq("trip_id", tripId).in("driver_id", driverIds).order("id").range(offset, offset + 999);
    if (page.error) return { data: null, error: page.error };
    data.push(...(page.data ?? []) as OfferAttempt[]);
    if ((page.data ?? []).length < 1000) return { data, error: null };
  }
}

export function untriedCandidatesFirst<T extends { driverId: string }>(
  candidates: T[], history: OfferAttempt[], cycle: number,
): T[] {
  const byDriver = new Map<string, OfferAttempt[]>();
  for (const row of history) {
    const attempts = byDriver.get(row.driver_id) ?? [];
    attempts.push(row);
    byDriver.set(row.driver_id, attempts);
  }
  const untried = candidates.filter(row => !byDriver.has(row.driverId));
  if (untried.length) return untried;
  // Only an explicit later round may retry expired offers, after untried eligible
  // drivers are exhausted. A declined driver is never retried for this trip.
  return candidates.filter(row => {
    const attempts = byDriver.get(row.driverId) ?? [];
    return attempts.length > 0 && attempts.every(attempt => attempt.status === "expired" &&
      attempt.dispatch_cycle != null && attempt.dispatch_cycle < cycle);
  });
}
