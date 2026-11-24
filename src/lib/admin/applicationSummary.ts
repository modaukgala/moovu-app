export const PHASE6_NEEDS_REVIEW = ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"] as const;

export type Phase6ApplicationRow = {
  id: string;
  driver_id: string;
  cycle: number;
  status: string;
  updated_at: string | null;
};

export type Phase6Decision = {
  action: string;
  created_at: string;
};

export type DriverApplicationSummary = {
  source: "phase6" | "legacy";
  id: string;
  driverId: string;
  cycle: number | null;
  status: string;
  decision: string | null;
  decisionAt: string | null;
  updatedAt: string | null;
};

export function currentPhase6ByDriver(rows: Phase6ApplicationRow[]) {
  const result = new Map<string, Phase6ApplicationRow>();
  for (const row of rows) {
    const previous = result.get(row.driver_id);
    if (!previous || row.cycle > previous.cycle ||
      (row.cycle === previous.cycle && `${row.updated_at ?? ""}:${row.id}` > `${previous.updated_at ?? ""}:${previous.id}`)) {
      result.set(row.driver_id, row);
    }
  }
  return result;
}

export function applicationSummary(input: {
  driverId: string;
  verificationStatus: string | null;
  phase6?: Phase6ApplicationRow | null;
  decision?: Phase6Decision | null;
}): DriverApplicationSummary {
  if (input.phase6) {
    return {
      source: "phase6",
      id: input.phase6.id,
      driverId: input.driverId,
      cycle: input.phase6.cycle,
      status: input.phase6.status,
      decision: input.decision?.action ?? null,
      decisionAt: input.decision?.created_at ?? null,
      updatedAt: input.phase6.updated_at,
    };
  }
  const status = String(input.verificationStatus || "unavailable");
  return {
    source: "legacy",
    id: input.driverId,
    driverId: input.driverId,
    cycle: null,
    status,
    decision: ["approved", "rejected"].includes(status.toLowerCase()) ? status.toUpperCase() : null,
    decisionAt: null,
    updatedAt: null,
  };
}

export function applicantSearchText(input: {
  driver?: { first_name?: string | null; last_name?: string | null; phone?: string | null; email?: string | null } | null;
  snapshot?: { personal?: { first_name?: string | null; last_name?: string | null; phone?: string | null } } | null;
}) {
  return [
    input.driver?.first_name, input.driver?.last_name, input.driver?.phone, input.driver?.email,
    input.snapshot?.personal?.first_name, input.snapshot?.personal?.last_name, input.snapshot?.personal?.phone,
  ].filter(Boolean).join(" ").toLowerCase();
}

