import type { SupabaseClient } from "@supabase/supabase-js";
// @ts-expect-error Node strip-types tests require an explicit extension.
import { ACTIVE_DRIVER_OFFER_STATUSES } from "./offerContract.ts";

export function expireTripOffers(supabase: SupabaseClient, tripId: string, now: string) {
  return supabase.from("driver_trip_offers")
    .update({ status: "expired", updated_at: now })
    .eq("trip_id", tripId)
    .in("status", [...ACTIVE_DRIVER_OFFER_STATUSES])
    .lte("accept_deadline_at", now);
}
