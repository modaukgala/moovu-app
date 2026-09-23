/** Phase 4A contracts only: no route, booking guard, RPC, or ledger writer calls these yet. */
export type AssessmentStatus = "ASSESSED" | "REVERSED";
export type LiabilityStatus = "ASSESSED" | "OPEN" | "DISPUTED" | "RESOLVED" | "WAIVED" | "REVERSED" | "WRITTEN_OFF";
export type CompensationStatus = "EARNED" | "PAYABLE" | "CREDITED" | "SETTLED" | "REVERSED";
export type FeeType = "LATE_CANCELLATION" | "NO_SHOW";

export type AssessmentSnapshot = Readonly<{
  tripId: string;
  customerId: string;
  driverId: string;
  feeType: FeeType;
  service: "GO" | "GO_XL";
  policyVersion: string;
  policyEffectiveFrom: string;
  assessedAt: string;
  clockBasis: "TRIP_CREATED_AT" | "SERVER_ARRIVED_AT";
  lockedTripState: string;
  assignedDriverId: string;
  feeCents: number;
  driverCents: number;
  moovuCents: number;
  currency: "ZAR";
  arrivalEvidenceVersion: string | null;
  sourceEventKey: string;
  idempotencyKey: string;
  status: AssessmentStatus;
}>;

export function assessmentSnapshot(input: AssessmentSnapshot): AssessmentSnapshot {
  if (!input.tripId || !input.customerId || !input.driverId || !input.assignedDriverId
    || !input.policyVersion || !input.sourceEventKey || !input.idempotencyKey
    || input.currency !== "ZAR" || input.status !== "ASSESSED") throw new Error("Incomplete assessment source.");
  if ([input.feeCents, input.driverCents, input.moovuCents].some((n) => !Number.isSafeInteger(n) || n < 0)
    || input.feeCents !== input.driverCents + input.moovuCents) throw new Error("Assessment does not balance.");
  if (input.feeType === "NO_SHOW" && (!input.arrivalEvidenceVersion || input.clockBasis !== "SERVER_ARRIVED_AT")) {
    throw new Error("No-show assessment requires server arrival evidence.");
  }
  for (const at of [input.policyEffectiveFrom, input.assessedAt]) {
    if (!Number.isFinite(Date.parse(at))) throw new Error("Assessment timestamp is invalid.");
  }
  return Object.freeze({ ...input });
}

export type CustomerLiability = Readonly<{
  assessmentId: string;
  customerId: string;
  originalCents: number;
  openCents: number;
  collectedCents: number;
  waivedCents: number;
  reversedCents: number;
  writtenOffCents: number;
  status: LiabilityStatus;
  finalizedAt: string | null;
  disputedAt: string | null;
  resolutionAt: string | null;
  resolutionActorId: string | null;
  resolutionReason: string | null;
}>;

export function assertLiability(liability: CustomerLiability): void {
  const amounts = [liability.originalCents, liability.openCents, liability.collectedCents,
    liability.waivedCents, liability.reversedCents, liability.writtenOffCents];
  if (amounts.some((n) => !Number.isSafeInteger(n) || n < 0)
    || liability.openCents + liability.collectedCents + liability.waivedCents
      + liability.reversedCents + liability.writtenOffCents !== liability.originalCents) {
    throw new Error("Customer liability allocation is invalid.");
  }
  if (["OPEN", "DISPUTED", "RESOLVED", "WAIVED", "REVERSED", "WRITTEN_OFF"].includes(liability.status)
    && !liability.finalizedAt) throw new Error("Finalized liability requires a timestamp.");
  if (liability.status === "DISPUTED" && !liability.disputedAt) throw new Error("Dispute timestamp is required.");
  if (["RESOLVED", "WAIVED", "REVERSED", "WRITTEN_OFF"].includes(liability.status)
    && (liability.openCents !== 0 || !liability.resolutionAt || !liability.resolutionActorId || !liability.resolutionReason)) {
    throw new Error("Resolved liability needs allocation and audit details.");
  }
}

export type LiabilityAction = "FINALIZE" | "DISPUTE" | "DISPUTE_REJECTED" | "WAIVE" | "RESOLVE" | "REVERSE" | "WRITE_OFF";
const allowed: Record<LiabilityAction, readonly LiabilityStatus[]> = {
  FINALIZE: ["ASSESSED"], DISPUTE: ["OPEN"], DISPUTE_REJECTED: ["DISPUTED"],
  WAIVE: ["OPEN", "DISPUTED"], RESOLVE: ["OPEN"], REVERSE: ["OPEN", "DISPUTED"],
  WRITE_OFF: ["OPEN"],
};
export function nextLiabilityStatus(current: LiabilityStatus, action: LiabilityAction): LiabilityStatus {
  if (!allowed[action].includes(current)) throw new Error("Invalid liability transition.");
  return {
    FINALIZE: "OPEN", DISPUTE: "DISPUTED", DISPUTE_REJECTED: "OPEN", WAIVE: "WAIVED",
    RESOLVE: "RESOLVED", REVERSE: "REVERSED", WRITE_OFF: "WRITTEN_OFF",
  }[action] as LiabilityStatus;
}

export type DriverCompensation = Readonly<{
  assessmentId: string;
  driverId: string;
  earnedCents: number;
  settledCents: number;
  status: CompensationStatus;
  earnedAt: string;
  settlementSourceId: string | null;
}>;
export function compensationFromAssessment(assessmentId: string, snapshot: AssessmentSnapshot): DriverCompensation {
  if (!assessmentId || snapshot.driverCents <= 0) throw new Error("A positive assessed Driver split is required.");
  return Object.freeze({ assessmentId, driverId: snapshot.driverId, earnedCents: snapshot.driverCents,
    settledCents: 0, status: "EARNED", earnedAt: snapshot.assessedAt, settlementSourceId: null });
}

export type GraceCycle = Readonly<{ id: string; customerId: string; startedAt: string; resolvedAt: string | null }>;
export type GraceConsumption = Readonly<{
  cycleId: string; completedTripId: string; completedAt: string; tripStatus: string;
}>;
export function evaluateTwoRideGrace(input: {
  cycle: GraceCycle | null;
  liabilities: readonly CustomerLiability[];
  consumptions: readonly GraceConsumption[];
}): Readonly<{ outstandingCents: number; ridesUsed: number; ridesRemaining: number; restrictNextBooking: boolean }> {
  const cycle = input.cycle;
  if (!cycle || cycle.resolvedAt) return { outstandingCents: 0, ridesUsed: 0, ridesRemaining: 2, restrictNextBooking: false };
  const outstandingCents = input.liabilities.filter((liability) => liability.customerId === cycle.customerId
    && liability.status === "OPEN" && !!liability.finalizedAt && liability.openCents > 0)
    .reduce((sum, liability) => sum + liability.openCents, 0);
  if (!Number.isSafeInteger(outstandingCents)) throw new Error("Outstanding amount is unsafe.");
  if (outstandingCents === 0) return { outstandingCents: 0, ridesUsed: 0, ridesRemaining: 2, restrictNextBooking: false };
  // A cycle persists while debts overlap. Consumption rows are written only for completed
  // rides while a finalized, undisputed qualifying liability exists; disputes pause usage.
  const rides = new Set(input.consumptions.filter((ride) => ride.cycleId === cycle.id
    && ride.tripStatus === "completed"
    && Date.parse(ride.completedAt) > Date.parse(cycle.startedAt)).map((ride) => ride.completedTripId));
  const ridesUsed = Math.min(2, rides.size);
  return { outstandingCents, ridesUsed, ridesRemaining: 2 - ridesUsed,
    restrictNextBooking: outstandingCents > 0 && ridesUsed >= 2 };
}

export type Phase4SourceKind = "cancellation_assessment" | "no_show_assessment" | "customer_liability"
  | "driver_compensation" | "customer_collection" | "fee_waiver" | "fee_reversal" | "dispute_resolution";
export function phase4SourceKey(kind: Phase4SourceKind, sourceId: string): string {
  const id = sourceId.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,99}$/.test(id)) throw new Error("Stable source ID is required.");
  return `phase4:${kind}:${id}`;
}

export type Phase4JournalLine = Readonly<{ accountCategory: string; side: "DEBIT" | "CREDIT"; cents: number }>;
export function assessedFeeJournal(snapshot: AssessmentSnapshot): readonly Phase4JournalLine[] {
  const draft: Phase4JournalLine[] = [
    { accountCategory: "CANCELLATION_NO_SHOW_RECEIVABLE", side: "DEBIT", cents: snapshot.feeCents },
    { accountCategory: "DRIVER_COMPENSATION_PAYABLE", side: "CREDIT", cents: snapshot.driverCents },
    // Revenue recognition is a separate accounting decision. This is an economic control,
    // not cash or recognized revenue.
    { accountCategory: "ADJUSTMENT_CLEARING", side: "CREDIT", cents: snapshot.moovuCents },
  ];
  const lines = draft.filter((line) => line.cents > 0);
  if (lines.reduce((n, line) => n + (line.side === "DEBIT" ? line.cents : -line.cents), 0) !== 0) {
    throw new Error("Phase 4 assessment journal is not balanced.");
  }
  return Object.freeze(lines.map((line) => Object.freeze(line)));
}
