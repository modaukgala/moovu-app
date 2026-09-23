import type { SupabaseClient } from "@supabase/supabase-js";

export async function phase6NewWork(client: SupabaseClient, driverId: string) {
  const { data, error } = await client.rpc("phase6_new_work_eligible", { p_driver: driverId });
  if (error || typeof data !== "boolean") return { ok: false as const, eligible: false, error: "Driver onboarding eligibility is unavailable." };
  return { ok: true as const, eligible: data, error: data ? null : "Complete your Driver onboarding or re-registration before accepting new work." };
}
