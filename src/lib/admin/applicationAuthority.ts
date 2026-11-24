import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  currentPhase6ByDriver,
  type Phase6ApplicationRow,
  type Phase6Decision,
} from "./applicationSummary";

export async function loadApplicationAuthority(client: SupabaseClient, driverIds: string[]) {
  const applications: Phase6ApplicationRow[] = [];
  for (let start = 0; start < driverIds.length; start += 100) {
    const ids = driverIds.slice(start, start + 100);
    if (!ids.length) continue;
    for (let offset = 0; offset < 10_000; offset += 500) {
      const result = await client.from("phase6_applications")
        .select("id,driver_id,cycle,status,updated_at")
        .in("driver_id", ids)
        .order("cycle", { ascending: false })
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 499);
      if (result.error) throw new Error("Phase 6 application records are unavailable.");
      applications.push(...((result.data ?? []) as Phase6ApplicationRow[]));
      if ((result.data ?? []).length < 500) break;
    }
  }
  const current = currentPhase6ByDriver(applications);
  const applicationIds = [...current.values()].map((row) => row.id);
  const decisions = new Map<string, Phase6Decision>();
  for (let start = 0; start < applicationIds.length; start += 100) {
    const ids = applicationIds.slice(start, start + 100);
    const result = await client.from("phase6_reviews")
      .select("application_id,action,created_at,id")
      .in("application_id", ids)
      .in("action", ["APPROVED", "REJECTED"])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (result.error) throw new Error("Phase 6 review decisions are unavailable.");
    for (const row of result.data ?? []) {
      if (!decisions.has(row.application_id)) {
        decisions.set(row.application_id, { action: row.action, created_at: row.created_at });
      }
    }
  }
  return { applications, current, decisions };
}

