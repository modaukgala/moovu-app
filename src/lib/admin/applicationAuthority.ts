import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PHASE6_NEEDS_REVIEW, currentPhase6ByDriver, type Phase6ApplicationRow } from "./applicationSummary";

export type AdminReviewMetric = {
  source: "phase6_applications";
  scope: "current_review_queue";
  statuses: readonly ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"];
  count: number;
  asOf: string;
  href: "/admin/onboarding";
};

export async function loadAdminReviewMetric(): Promise<AdminReviewMetric> {
  const asOf = new Date().toISOString();
  const statuses = PHASE6_NEEDS_REVIEW;
  const { count, error } = await supabaseAdmin.from("phase6_applications")
    .select("id", { count: "exact", head: true }).in("status", [...statuses]);
  if (error || count === null) throw new Error("Admin review metric unavailable.");
  return { source: "phase6_applications", scope: "current_review_queue", statuses, count, asOf, href: "/admin/onboarding" };
}

export async function loadCurrentPhase6ForDrivers(driverIds: string[]) {
  const applications: Phase6ApplicationRow[] = [];
  const existing = new Set<string>();
  for (let start = 0; start < driverIds.length; start += 100) {
    const ids = driverIds.slice(start, start + 100);
    for (let offset = 0; ; offset += 1000) {
      const result = await supabaseAdmin.from("phase6_applications")
        .select("id,driver_id,cycle,status,updated_at").in("driver_id", ids)
        .order("id").range(offset, offset + 999);
      if (result.error) throw new Error("Phase 6 application summary unavailable.");
      applications.push(...((result.data ?? []) as Phase6ApplicationRow[]));
      if ((result.data?.length ?? 0) < 1000) break;
      if (offset >= 9000) throw new Error("Phase 6 application summary exceeds safe page limit.");
    }
    const enrollment = await supabaseAdmin.from("phase6_enrollments")
      .select("driver_id,existing_driver").in("driver_id", ids);
    if (enrollment.error) throw new Error("Phase 6 enrollment summary unavailable.");
    for (const row of enrollment.data ?? []) if (row.existing_driver === true) existing.add(row.driver_id);
  }
  return { current: currentPhase6ByDriver(applications), existing };
}
