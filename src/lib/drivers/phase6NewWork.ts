import type { SupabaseClient } from "@supabase/supabase-js";
// @ts-expect-error Node strip-types tests require an explicit extension.
import { phase6EligibilityEnabled } from "../release/releaseFlags.ts";

export async function phase6NewWork(client: SupabaseClient, driverId: string) {
  if (!phase6EligibilityEnabled()) {
    return { ok: true as const, eligible: true, authority: "legacy_production" as const, error: null };
  }
  const { data, error } = await client.rpc("phase6_new_work_eligible", { p_driver: driverId });
  if (error || typeof data !== "boolean") return { ok: false as const, eligible: false, error: "Driver onboarding eligibility is unavailable." };
  return { ok: true as const, eligible: data, authority: "phase6" as const, error: data ? null : "Complete your Driver onboarding or re-registration before accepting new work." };
}
