export const PHASE6_NEEDS_REVIEW = ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"] as const;

export type ApplicationSource = "phase6" | "legacy";
export type AdminApplicationState = "needs_review" | "driver_action" | "draft" | "approved" | "rejected" | "unavailable";

export type CurrentApplication = {
  source: ApplicationSource;
  id: string;
  driverId: string;
  cycle: number | null;
  status: string;
  state: AdminApplicationState;
  existingDriver: boolean;
  updatedAt: string | null;
  scope: "current_cycle" | "legacy_driver_verification";
};

export type DriverAdminSummary = {
  driverId: string;
  identity: { source: "drivers.id"; asOf: string };
  application: CurrentApplication | null;
  onboardingReadiness: { source: "phase6_applications.status" | "legacy_driver_verification" | "unavailable"; state: AdminApplicationState; asOf: string | null };
  operationalEligibility: { source: "authoritative_runtime_required"; state: "not_evaluated"; asOf: null };
  presence: { source: "drivers.online/busy"; state: "offline" | "online" | "busy"; asOf: string };
};

export type Phase6ApplicationRow = {
  id: string;
  driver_id: string;
  cycle: number;
  status: string;
  updated_at: string | null;
};

export function phase6ApplicationState(status: string): AdminApplicationState {
  if (PHASE6_NEEDS_REVIEW.some(value => value === status)) return "needs_review";
  if (status === "CORRECTION_REQUESTED") return "driver_action";
  if (status === "APPROVED") return "approved";
  if (status === "REJECTED") return "rejected";
  if (status === "DRAFT") return "draft";
  return "unavailable";
}

export function currentPhase6ByDriver(rows: Phase6ApplicationRow[]): Map<string, Phase6ApplicationRow> {
  const current = new Map<string, Phase6ApplicationRow>();
  for (const row of rows) {
    const previous = current.get(row.driver_id);
    if (!previous || row.cycle > previous.cycle || row.cycle === previous.cycle && (row.updated_at ?? "") > (previous.updated_at ?? "")) current.set(row.driver_id, row);
  }
  return current;
}

export function driverAdminSummary(input: {
  id: string; status: string | null; verification_status: string | null;
  online: boolean | null; busy: boolean | null;
  phase6?: Phase6ApplicationRow | null; existingDriver?: boolean;
}, asOf: string): DriverAdminSummary {
  const phase6 = input.phase6;
  const legacyStatus = String(input.verification_status ?? "").toLowerCase();
  const legacyState: AdminApplicationState = legacyStatus === "approved" ? "approved"
    : legacyStatus === "rejected" ? "rejected"
      : legacyStatus === "pending_review" ? "needs_review" : "unavailable";
  const application: CurrentApplication | null = phase6 ? {
    source: "phase6", id: phase6.id, driverId: input.id, cycle: phase6.cycle,
    status: phase6.status, state: phase6ApplicationState(phase6.status),
    existingDriver: input.existingDriver === true || phase6.cycle > 1 || legacyStatus === "approved",
    updatedAt: phase6.updated_at, scope: "current_cycle",
  } : legacyStatus ? {
    source: "legacy", id: input.id, driverId: input.id, cycle: null,
    status: legacyStatus, state: legacyState, existingDriver: legacyStatus === "approved",
    updatedAt: null, scope: "legacy_driver_verification",
  } : null;
  return {
    driverId: input.id, identity: { source: "drivers.id", asOf }, application,
    onboardingReadiness: {
      source: phase6 ? "phase6_applications.status" : legacyStatus ? "legacy_driver_verification" : "unavailable",
      state: application?.state ?? "unavailable", asOf: application?.updatedAt ?? null,
    },
    operationalEligibility: { source: "authoritative_runtime_required", state: "not_evaluated", asOf: null },
    presence: { source: "drivers.online/busy", state: input.busy ? "busy" : input.online ? "online" : "offline", asOf },
  };
}

export function phase6NeedsReviewCount(rows: Pick<Phase6ApplicationRow, "status">[]): number {
  return rows.filter(row => phase6ApplicationState(row.status) === "needs_review").length;
}

export function adminApplicationLabel(summary: DriverAdminSummary | null | undefined): string {
  if (!summary) return "Application state unavailable";
  const app = summary.application;
  if (!app) return "No current application";
  const state: Record<AdminApplicationState, string> = {
    needs_review: "Needs Admin review", driver_action: "Needs Driver action", draft: "Draft",
    approved: "Application approved", rejected: "Application rejected", unavailable: "Status unavailable",
  };
  const source = app.source === "phase6" ? app.existingDriver ? "Existing Driver re-application" : "Phase 6 application" : "Legacy verification";
  return `${source} · ${state[app.state]}`;
}
