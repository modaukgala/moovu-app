import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types runner requires the explicit extension.
import { presentCompletedOnlineEarning } from "./onlineEarningPresentation.ts";

const trip = { id: "trip-a", driver_id: "driver-a", ride_option: "go", completed_at: "2026-11-02T10:00:00Z",
  phase5_policy_version: "phase5-2026-09-owner-v1", phase5_driver_fare_basis_cents: 4600,
  phase5_customer_total_cents: 4900, phase5_service_fee_cents: 300,
  phase5_membership_waiver_cents: 0, phase5_credit_cents: 0, commission_amount: 6.9,
  final_fare: 49, fare_amount: 49 };
const attempt = { id: "attempt-a", trip_id: trip.id, amount_cents: 4900,
  state: "SUCCEEDED", reconciliation_state: "MATCHED", verified_at: "2026-11-02T09:00:00Z",
  payment_ledger_transaction_id: "ledger-a" };
const evidence = { payment_attempt_id: attempt.id, actual_fee_cents: 372,
  percentage_fee_cents: 172, fixed_fee_cents: 200, source_type: "PROVIDER_EXPORT",
  source_reference: "synthetic-source" };
const cutoff = "2026-11-02T00:00:00Z";

test("completed paid trip stays visible with pending evidence and no confirmed liability", () => {
  const row = presentCompletedOnlineEarning(trip, attempt, undefined, cutoff);
  assert.equal(row?.status, "PENDING_FEE_VERIFICATION");
  assert.equal(row?.calculation?.estimated.payoutBeforeDebtCents, 3724);
  assert.equal(row?.calculation?.confirmedPayableCents, null);
});

test("matching component evidence yields the Option B calculation", () => {
  const row = presentCompletedOnlineEarning(trip, attempt, evidence, cutoff);
  assert.equal(row?.status, "VERIFIED_FOR_REVIEW");
  assert.equal(row?.calculation?.confirmedPayableCents, 3724);
});

test("Go XL locked R5 fee remains visible with the approved R1/R4 split", () => {
  const xlTrip = { ...trip, ride_option: "group", phase5_service_fee_cents: 500,
    phase5_customer_total_cents: 5100 };
  const xlAttempt = { ...attempt, amount_cents: 5100 };
  const xlEvidence = { ...evidence, percentage_fee_cents: 179, actual_fee_cents: 379 };
  const row = presentCompletedOnlineEarning(xlTrip, xlAttempt, xlEvidence, cutoff);
  assert.equal(row?.status, "VERIFIED_FOR_REVIEW");
  assert.equal(row?.calculation?.moovuBookingFeeCents, 400);
  assert.equal(row?.calculation?.confirmedPayableCents, 3720);
});

test("missing component split stays pending rather than assuming a 50/50 total-fee split", () => {
  const row = presentCompletedOnlineEarning(trip, attempt,
    { ...evidence, percentage_fee_cents: null, fixed_fee_cents: null }, cutoff);
  assert.equal(row?.status, "PENDING_FEE_VERIFICATION");
  assert.equal(row?.calculation?.confirmedPayableCents, null);
});

test("earlier trips preserve their legacy financial policy", () => {
  const row = presentCompletedOnlineEarning(trip, attempt, evidence, "2026-11-03T00:00:00Z");
  assert.equal(row?.status, "PENDING_LEGACY_PAYOUT");
  assert.equal(row?.calculation?.confirmedPayableCents, null);
});

test("unmatched, refunded, or invalid fare inputs are not presented as payables", () => {
  assert.equal(presentCompletedOnlineEarning(trip, { ...attempt, state: "FAILED" }, evidence, cutoff), null);
  assert.equal(presentCompletedOnlineEarning(trip, { ...attempt, reconciliation_state: "PENDING" }, evidence, cutoff), null);
  assert.equal(presentCompletedOnlineEarning(trip, { ...attempt, payment_ledger_transaction_id: null }, evidence, cutoff), null);
  assert.equal(presentCompletedOnlineEarning({ ...trip, phase5_customer_total_cents: 5000 }, attempt,
    evidence, cutoff)?.status, "RECONCILIATION_REQUIRED");
});
