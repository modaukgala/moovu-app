import type { SupabaseClient } from "@supabase/supabase-js";
import { collectBoundedPages } from "./boundedRetrieval";
import { type EarningsTrip, earningsPeriod } from "./earningsMetrics";

export const tripProjection = "id,driver_id,completed_at,payment_method,fare_amount,commission_pct,commission_amount,driver_net_earnings";
export type Period = ReturnType<typeof earningsPeriod>;

export function completedTrips(db: SupabaseClient, period: Period) {
  return db.from("trips").select(tripProjection, { count: "exact" })
    .eq("status", "completed").gte("completed_at", period.start).lt("completed_at", period.end)
    .order("completed_at", { ascending: false }).order("id", { ascending: false });
}

export async function scanTrips(db: SupabaseClient, period: Period) {
  return collectBoundedPages<EarningsTrip>({
    pageSize: 500, maxRows: 10000,
    load: async (from, to) => {
      const result = await completedTrips(db, period).range(from, to);
      if (result.error || !Array.isArray(result.data)) throw new Error("Trip snapshots unavailable.");
      return result.data as EarningsTrip[];
    },
  });
}

export async function verifiedOnlineReceipts(db: SupabaseClient, period: Period) {
  const { data, error } = await db.rpc("admin_verified_yoco_payments_report", {
    p_from: period.start, p_to: period.end, p_payer: "all", p_page: 1, p_limit: 1,
  });
  if (error || !Number.isSafeInteger(data?.total_cents) || !Number.isSafeInteger(data?.trip_cents)) return null;
  return { total: data.total_cents / 100, customerTrips: data.trip_cents / 100 };
}
