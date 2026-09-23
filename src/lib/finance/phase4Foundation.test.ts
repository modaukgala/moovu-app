import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node strip-types runner requires the explicit extension.
import { PHASE4_POLICY, assertPhase4Policy, decideCustomerCancellation, decideNoShow, elapsedAtLeast, selectPhase4Policy } from "./phase4Policy.ts";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node strip-types runner requires the explicit extension.
import { assessmentSnapshot, assertLiability, assessedFeeJournal, compensationFromAssessment, evaluateTwoRideGrace, nextLiabilityStatus, phase4SourceKey } from "./phase4Foundation.ts";

const created = "2026-10-01T12:00:00.000Z";
const at = (ms: number) => new Date(Date.parse(created) + ms).toISOString();
const activePolicy = { ...PHASE4_POLICY, effectiveFrom: "2026-10-01T00:00:00.000Z" };

test("policy has exact ZAR integer-cent amounts and balanced splits", () => {
  assertPhase4Policy(PHASE4_POLICY);
  assert.deepEqual(PHASE4_POLICY.fees.GO.LATE_CANCELLATION, { feeCents: 2000, driverCents: 1300, moovuCents: 700 });
  assert.deepEqual(PHASE4_POLICY.fees.GO_XL.LATE_CANCELLATION, { feeCents: 3000, driverCents: 2000, moovuCents: 1000 });
  assert.deepEqual(PHASE4_POLICY.fees.GO.NO_SHOW, { feeCents: 3000, driverCents: 2200, moovuCents: 800 });
  assert.deepEqual(PHASE4_POLICY.fees.GO_XL.NO_SHOW, { feeCents: 4000, driverCents: 3000, moovuCents: 1000 });
  assert.equal(PHASE4_POLICY.currency, "ZAR");
  assert.equal(PHASE4_POLICY.freeSeconds, 180);
  assert.equal(PHASE4_POLICY.noShowSeconds, 300);
});

test("before, at, and after three minutes; unassigned always free", () => {
  const base = { policy: activePolicy, service: "GO" as const, tripCreatedAt: created,
    lockedTripState: "assigned" as const, assignedDriverId: "driver-1" };
  assert.equal(decideCustomerCancellation({ ...base, decisionAt: at(179999) }).kind, "FREE");
  assert.equal(decideCustomerCancellation({ ...base, decisionAt: at(180000) }).split.feeCents, 2000);
  assert.equal(decideCustomerCancellation({ ...base, decisionAt: at(180001) }).kind, "LATE_CANCELLATION");
  for (const state of ["requested", "offered"] as const) {
    assert.equal(decideCustomerCancellation({ ...base, lockedTripState: state, assignedDriverId: null, decisionAt: at(900000) }).kind, "FREE");
  }
  assert.equal(decideCustomerCancellation({ ...base, lockedTripState: "arrived", decisionAt: at(180000) }).kind, "LATE_CANCELLATION");
  assert.equal(decideCustomerCancellation({ ...base, service: "GO_XL", decisionAt: at(180000) }).split.driverCents, 2000);
});

test("no-show needs assigned Driver, qualified arrival, and exact five-minute boundary", () => {
  const base = { policy: activePolicy, service: "GO_XL" as const, serverArrivedAt: created,
    lockedTripState: "arrived", assignedDriverId: "driver-1", actorDriverId: "driver-1", arrivalEvidenceQualified: true };
  assert.equal(decideNoShow({ ...base, decisionAt: at(299999) }).eligible, false);
  assert.deepEqual(decideNoShow({ ...base, decisionAt: at(300000) }).split,
    { feeCents: 4000, driverCents: 3000, moovuCents: 1000 });
  assert.equal(decideNoShow({ ...base, decisionAt: at(300001) }).eligible, true);
  assert.equal(decideNoShow({ ...base, decisionAt: at(300001), arrivalEvidenceQualified: false }).eligible, false);
  assert.equal(decideNoShow({ ...base, decisionAt: at(300001), actorDriverId: "other" }).eligible, false);
  assert.equal(elapsedAtLeast(created, at(300000), 300), true);
});

test("policy selection respects effective time and rejects ambiguous cutover", () => {
  assert.equal(selectPhase4Policy([PHASE4_POLICY], created), null); // no accidental activation
  const older = { ...activePolicy, version: "older", effectiveFrom: "2026-09-01T00:00:00.000Z" };
  assert.equal(selectPhase4Policy([activePolicy, older], created)?.version, activePolicy.version);
  assert.throws(() => selectPhase4Policy([activePolicy, { ...activePolicy, version: "duplicate" }], created));
});

const snapshot = assessmentSnapshot({
  tripId: "trip-1", customerId: "customer-1", driverId: "driver-1", assignedDriverId: "driver-1",
  feeType: "LATE_CANCELLATION", service: "GO", policyVersion: activePolicy.version,
  policyEffectiveFrom: activePolicy.effectiveFrom, assessedAt: at(180000), clockBasis: "TRIP_CREATED_AT",
  lockedTripState: "assigned", feeCents: 2000, driverCents: 1300, moovuCents: 700,
  currency: "ZAR", arrivalEvidenceVersion: null, sourceEventKey: "trip-cancel:trip-1",
  idempotencyKey: "phase4:cancellation_assessment:trip-1", status: "ASSESSED",
});

test("snapshot is immutable, compensation is earned without collection, journal has no cash", () => {
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(() => assessmentSnapshot({ ...snapshot, feeCents: 2001 }));
  const compensation = compensationFromAssessment("assessment-1", snapshot);
  assert.equal(compensation.status, "EARNED");
  assert.equal(compensation.settledCents, 0);
  assert.deepEqual(assessedFeeJournal(snapshot).map((line) => [line.accountCategory, line.side, line.cents]), [
    ["CANCELLATION_NO_SHOW_RECEIVABLE", "DEBIT", 2000],
    ["DRIVER_COMPENSATION_PAYABLE", "CREDIT", 1300],
    ["ADJUSTMENT_CLEARING", "CREDIT", 700],
  ]);
  assert.equal(assessedFeeJournal(snapshot).some((line) => line.accountCategory === "PAYMENT_CLEARING"), false);
});

const liability = { assessmentId: "assessment-1", customerId: "customer-1", originalCents: 2000,
  openCents: 2000, collectedCents: 0, waivedCents: 0, reversedCents: 0, writtenOffCents: 0,
  status: "OPEN" as const, finalizedAt: created, disputedAt: null, resolutionAt: null,
  resolutionActorId: null, resolutionReason: null };
const cycle = { id: "cycle-1", customerId: "customer-1", startedAt: created, resolvedAt: null };
const ride = (id: string, ms: number) => ({ cycleId: cycle.id, completedTripId: id, completedAt: at(ms), tripStatus: "completed" });

test("liability states, disputes, reversals and allocation invariants", () => {
  assertLiability(liability);
  assert.equal(nextLiabilityStatus("ASSESSED", "FINALIZE"), "OPEN");
  assert.equal(nextLiabilityStatus("OPEN", "DISPUTE"), "DISPUTED");
  assert.equal(nextLiabilityStatus("DISPUTED", "DISPUTE_REJECTED"), "OPEN");
  assert.equal(nextLiabilityStatus("DISPUTED", "WAIVE"), "WAIVED");
  assert.equal(nextLiabilityStatus("OPEN", "REVERSE"), "REVERSED");
  assert.throws(() => nextLiabilityStatus("REVERSED", "REVERSE"));
  assert.throws(() => assertLiability({ ...liability, collectedCents: 1 }));
});

test("two completed grace rides, third booking block, dispute pause and no reset from added debt", () => {
  const one = [ride("trip-a", 1000)];
  const two = [...one, ride("trip-b", 2000)];
  assert.deepEqual(evaluateTwoRideGrace({ cycle, liabilities: [liability], consumptions: [] }),
    { outstandingCents: 2000, ridesUsed: 0, ridesRemaining: 2, restrictNextBooking: false });
  assert.equal(evaluateTwoRideGrace({ cycle, liabilities: [liability], consumptions: one }).ridesRemaining, 1);
  for (const state of ["requested", "offered", "cancelled", "no_show", "failed"] as const) {
    assert.equal(evaluateTwoRideGrace({ cycle, liabilities: [liability],
      consumptions: [{ ...ride("ignored", 1500), tripStatus: state }] }).ridesRemaining, 2);
  }
  assert.equal(evaluateTwoRideGrace({ cycle, liabilities: [liability], consumptions: two }).restrictNextBooking, true);
  const additional = { ...liability, assessmentId: "assessment-2", originalCents: 3000, openCents: 3000, finalizedAt: at(5000) };
  assert.equal(evaluateTwoRideGrace({ cycle, liabilities: [liability, additional], consumptions: two }).ridesRemaining, 0);
  const disputed = { ...liability, status: "DISPUTED" as const, disputedAt: at(3000) };
  assert.equal(evaluateTwoRideGrace({ cycle, liabilities: [disputed], consumptions: two }).restrictNextBooking, false);
  const resolved = { ...liability, status: "RESOLVED" as const, openCents: 0, collectedCents: 2000,
    resolutionAt: at(4000), resolutionActorId: "admin-1", resolutionReason: "paid" };
  assert.equal(evaluateTwoRideGrace({ cycle, liabilities: [resolved], consumptions: two }).restrictNextBooking, false);
  const laterCycle = { ...cycle, id: "cycle-2", startedAt: at(10000) };
  const laterDebt = { ...additional, finalizedAt: at(10000) };
  assert.equal(evaluateTwoRideGrace({ cycle: laterCycle, liabilities: [laterDebt], consumptions: two }).ridesRemaining, 2);
  assert.equal(evaluateTwoRideGrace({ cycle, liabilities: [liability], consumptions: [...two, ride("trip-b", 2000)] }).ridesUsed, 2);
});

test("migration is additive and neither historical nor Phase 2 authority is touched", () => {
  const sql = readFileSync("docs/phase-4a-financial-state-foundation.sql", "utf8");
  assert.match(sql, /create table public\.phase4_fee_assessments/i);
  assert.match(sql, /create unique index phase4_one_active_grace_cycle_per_customer/i);
  assert.match(sql, /create trigger phase4_assessments_immutable/i);
  assert.match(sql, /create trigger phase4_liability_origin_immutable/i);
  assert.match(sql, /create trigger phase4_compensation_origin_immutable/i);
  assert.match(sql, /create trigger phase4_grace_cycle_origin_immutable/i);
  assert.doesNotMatch(sql, /\b(insert\s+into|update|delete\s+from|alter\s+table|drop\s+table)\s+public\.(trip_cancellation_fees|phase2_finance_policy|financial_transactions|financial_ledger_entries)\b/i);
  assert.doesNotMatch(sql, /\b(insert\s+into|update|delete\s+from)\s+public\.phase4_/i);
  const foundation = readFileSync("src/lib/finance/phase4Foundation.ts", "utf8");
  const policy = readFileSync("src/lib/finance/phase4Policy.ts", "utf8");
  assert.doesNotMatch(foundation + policy, /phase2_post|phase2Mode|applyTripCommission|MOOVU_PHASE2_FINANCE_MODE/);
});

test("source keys are stable and separated by economic action", () => {
  assert.equal(phase4SourceKey("cancellation_assessment", "TRIP-1"), phase4SourceKey("cancellation_assessment", "trip-1"));
  assert.notEqual(phase4SourceKey("no_show_assessment", "trip-1"), phase4SourceKey("cancellation_assessment", "trip-1"));
  for (const kind of ["customer_liability", "driver_compensation", "customer_collection", "fee_waiver", "fee_reversal", "dispute_resolution"] as const) {
    assert.ok(phase4SourceKey(kind, "source-1").startsWith(`phase4:${kind}:`));
  }
  assert.throws(() => phase4SourceKey("fee_reversal", " "));
});
