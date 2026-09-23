/** Review-only Phase 4A policy. Live cancellation RPCs do not use this module yet. */
export const PHASE4_POLICY_VERSION = "phase4-2026-09-owner-v1";
export const PHASE4_CURRENCY = "ZAR";
export const PHASE4_FREE_SECONDS = 180;
export const PHASE4_NO_SHOW_SECONDS = 300;

export type Phase4Service = "GO" | "GO_XL";
export type Phase4FeeKind = "LATE_CANCELLATION" | "NO_SHOW";
export type Phase4Split = Readonly<{ feeCents: number; driverCents: number; moovuCents: number }>;
export type Phase4Policy = Readonly<{
  version: string;
  effectiveFrom: string;
  currency: "ZAR";
  freeSeconds: number;
  noShowSeconds: number;
  fees: Readonly<Record<Phase4Service, Readonly<Record<Phase4FeeKind, Phase4Split>>>>;
}>;

export const PHASE4_POLICY: Phase4Policy = Object.freeze({
  version: PHASE4_POLICY_VERSION,
  // Cutover is deliberately unset until a separately approved activation.
  effectiveFrom: "9999-12-31T00:00:00.000Z",
  currency: PHASE4_CURRENCY,
  freeSeconds: PHASE4_FREE_SECONDS,
  noShowSeconds: PHASE4_NO_SHOW_SECONDS,
  fees: {
    GO: {
      LATE_CANCELLATION: { feeCents: 2000, driverCents: 1300, moovuCents: 700 },
      NO_SHOW: { feeCents: 3000, driverCents: 2200, moovuCents: 800 },
    },
    GO_XL: {
      LATE_CANCELLATION: { feeCents: 3000, driverCents: 2000, moovuCents: 1000 },
      NO_SHOW: { feeCents: 4000, driverCents: 3000, moovuCents: 1000 },
    },
  },
});

function milliseconds(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("A valid authoritative timestamp is required.");
  return parsed;
}

export function elapsedAtLeast(startAt: string, eventAt: string, seconds: number): boolean {
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error("Invalid policy duration.");
  return milliseconds(eventAt) - milliseconds(startAt) >= seconds * 1000;
}

export function selectPhase4Policy(policies: readonly Phase4Policy[], eventAt: string): Phase4Policy | null {
  const eventMs = milliseconds(eventAt);
  const applicable = policies.filter((policy) => milliseconds(policy.effectiveFrom) <= eventMs);
  applicable.sort((a, b) => milliseconds(b.effectiveFrom) - milliseconds(a.effectiveFrom));
  if (applicable.length > 1 && applicable[0].effectiveFrom === applicable[1].effectiveFrom) {
    throw new Error("Ambiguous Phase 4 policy effective date.");
  }
  return applicable[0] ?? null;
}

export type CancellationDecision = Readonly<{
  kind: "FREE" | "LATE_CANCELLATION";
  split: Phase4Split;
  policyVersion: string;
  clockBasis: "TRIP_CREATED_AT";
}>;

export function decideCustomerCancellation(input: {
  policy: Phase4Policy;
  service: Phase4Service;
  tripCreatedAt: string;
  decisionAt: string;
  lockedTripState: "requested" | "offered" | "assigned" | "arrived";
  assignedDriverId: string | null;
}): CancellationDecision {
  const free = !input.assignedDriverId || !["assigned", "arrived"].includes(input.lockedTripState)
    || !elapsedAtLeast(input.tripCreatedAt, input.decisionAt, input.policy.freeSeconds);
  return {
    kind: free ? "FREE" : "LATE_CANCELLATION",
    split: free ? { feeCents: 0, driverCents: 0, moovuCents: 0 }
      : input.policy.fees[input.service].LATE_CANCELLATION,
    policyVersion: input.policy.version,
    clockBasis: "TRIP_CREATED_AT",
  };
}

export function decideNoShow(input: {
  policy: Phase4Policy;
  service: Phase4Service;
  serverArrivedAt: string;
  decisionAt: string;
  lockedTripState: string;
  assignedDriverId: string | null;
  actorDriverId: string;
  arrivalEvidenceQualified: boolean;
}): Readonly<{ eligible: boolean; split: Phase4Split }> {
  const eligible = input.lockedTripState === "arrived"
    && !!input.assignedDriverId && input.assignedDriverId === input.actorDriverId
    && input.arrivalEvidenceQualified
    && elapsedAtLeast(input.serverArrivedAt, input.decisionAt, input.policy.noShowSeconds);
  return { eligible, split: eligible ? input.policy.fees[input.service].NO_SHOW
    : { feeCents: 0, driverCents: 0, moovuCents: 0 } };
}

export function assertPhase4Policy(policy: Phase4Policy): void {
  if (policy.currency !== "ZAR" || !policy.version || !Number.isFinite(Date.parse(policy.effectiveFrom))) {
    throw new Error("Invalid policy identity.");
  }
  for (const service of ["GO", "GO_XL"] as const) for (const kind of ["LATE_CANCELLATION", "NO_SHOW"] as const) {
    const split = policy.fees[service][kind];
    if (Object.values(split).some((value) => !Number.isSafeInteger(value) || value < 0)
      || split.feeCents !== split.driverCents + split.moovuCents) throw new Error("Invalid fee split.");
  }
}
