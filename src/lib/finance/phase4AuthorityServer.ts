import type { SupabaseClient } from "@supabase/supabase-js";

/** The first policy effective time fixes economic authority for the lifetime of a trip. */
export async function phase4AuthorityForTrip(admin: SupabaseClient, tripId: string) {
  const { data: trip, error: tripError } = await admin.from("trips")
    .select("id,created_at").eq("id", tripId).maybeSingle();
  if (tripError) throw new Error("Trip authority could not be checked.");
  if (!trip) return null;
  const { data: firstPolicy, error: policyError } = await admin.from("phase4_policies")
    .select("effective_from").order("effective_from", { ascending: true }).limit(1).maybeSingle();
  if (policyError) throw new Error("Phase 4 policy authority is unavailable.");
  return firstPolicy && Date.parse(trip.created_at) >= Date.parse(firstPolicy.effective_from)
    ? "PHASE4" as const : "LEGACY" as const;
}
