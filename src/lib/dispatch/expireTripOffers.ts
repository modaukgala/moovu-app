import type { SupabaseClient } from "@supabase/supabase-js";

export function expireTripOffers(supabase: SupabaseClient, tripId: string, now: string) {
  return supabase.from("driver_trip_offers")
    .update({ status: "expired", updated_at: now })
    .eq("trip_id", tripId)
    .in("status", ["pending", "shown"])
    .lte("accept_deadline_at", now);
}
