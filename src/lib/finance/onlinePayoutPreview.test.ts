import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types runner requires the explicit extension.
import { calculateOnlinePayoutPreview, type OnlinePayoutInput } from "./onlinePayoutPreview.ts";

const base: OnlinePayoutInput = {
  tripStatus: "completed",
  paymentState: "SUCCEEDED",
  paymentReconciliationState: "MATCHED",
  customerPaymentCents: 20000,
  commissionableFareCents: 20000,
  bookingFeeCents: 0,
  bookingFeeAuthority: "LEGACY_EMBEDDED",
  membershipWaiverCents: 0,
  promotionalCreditCents: 0,
  currentTripCommissionCents: 3000,
  previousCommissionDebtCents: 4500,
  verifiedYocoFee: { totalCents: 700, evidenceType: "PROVIDER_SETTLEMENT",
    evidenceReference: "synthetic-settlement-1", vatTreatment: "TOTAL_INCLUDES_VAT" },
  approvedDriverFeeShareBps: 5000,
};

test("proposed split and prior debt yield R121.50 without double current commission", () => {
  const result = calculateOnlinePayoutPreview(base);
  assert.equal(result.status, "READY_FOR_REVIEW");
  assert.equal(result.driverTripEarningsCents, 17000);
  assert.equal(result.driverYocoFeeShareCents, 350);
  assert.equal(result.moovuYocoFeeShareCents, 350);
  assert.equal(result.debtRecoveryCents, 4500);
  assert.equal(result.netPayoutCents, 12150);
});

test("actual fee, not a guessed 3.5%, controls the preview", () => {
  const result = calculateOnlinePayoutPreview({ ...base, verifiedYocoFee: {
    ...base.verifiedYocoFee!, totalCents: 587 }, previousCommissionDebtCents: 0 });
  assert.equal(result.driverYocoFeeShareCents, 294);
  assert.equal(result.moovuYocoFeeShareCents, 293);
  assert.equal(result.netPayoutCents, 16706);
});

test("missing fee or unapproved split prevents a final payout figure", () => {
  const missingFee = calculateOnlinePayoutPreview({ ...base, verifiedYocoFee: null });
  const missingPolicy = calculateOnlinePayoutPreview({ ...base, approvedDriverFeeShareBps: null });
  assert.equal(missingFee.status, "AWAITING_PROVIDER_FEE");
  assert.equal(missingPolicy.status, "AWAITING_FEE_POLICY");
  assert.equal(missingFee.netPayoutCents, null);
  assert.equal(missingPolicy.debtRecoveryCents, null);
});

test("recovery is capped at eligible earnings and carries forward excess debt", () => {
  const result = calculateOnlinePayoutPreview({ ...base, previousCommissionDebtCents: 20000 });
  assert.equal(result.debtRecoveryCents, 16650);
  assert.equal(result.remainingPreviousDebtCents, 3350);
  assert.equal(result.netPayoutCents, 0);
});

test("R3 Phase 5 service fee is separate from R100 commissionable fare", () => {
  const result = calculateOnlinePayoutPreview({ ...base, customerPaymentCents: 10300,
    commissionableFareCents: 10000, bookingFeeCents: 300,
    bookingFeeAuthority: "PHASE5_SEPARATE", currentTripCommissionCents: 1500,
    previousCommissionDebtCents: 0 });
  assert.equal(result.customerPaymentCents, 10300);
  assert.equal(result.driverTripEarningsCents, 8500);
  assert.equal(result.bookingFeeCents, 300);
  assert.equal(result.netPayoutCents, 8150);
});

test("Phase 5 waiver and credit reconcile without reducing Driver fare basis", () => {
  const result = calculateOnlinePayoutPreview({ ...base, customerPaymentCents: 9000,
    commissionableFareCents: 10000, bookingFeeCents: 300,
    bookingFeeAuthority: "PHASE5_SEPARATE", membershipWaiverCents: 300,
    promotionalCreditCents: 1000, currentTripCommissionCents: 1500,
    previousCommissionDebtCents: 0 });
  assert.equal(result.driverTripEarningsCents, 8500);
});

test("rejects double booking fee, incorrect commission, unverified fee and over-deduction", () => {
  assert.throws(() => calculateOnlinePayoutPreview({ ...base, bookingFeeCents: 300 }));
  assert.throws(() => calculateOnlinePayoutPreview({ ...base, currentTripCommissionCents: 3300 }));
  assert.throws(() => calculateOnlinePayoutPreview({ ...base, verifiedYocoFee: {
    ...base.verifiedYocoFee!, evidenceReference: "" } }));
  assert.throws(() => calculateOnlinePayoutPreview({ ...base, approvedDriverFeeShareBps: 10001 }));
  assert.throws(() => calculateOnlinePayoutPreview({ ...base, verifiedYocoFee: {
    ...base.verifiedYocoFee!, totalCents: 40000 } }));
  for (const paymentState of ["REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED", "RECONCILIATION_REQUIRED"]) {
    assert.throws(() => calculateOnlinePayoutPreview({ ...base, paymentState }));
  }
  assert.throws(() => calculateOnlinePayoutPreview({ ...base, tripStatus: "cancelled" }));
  assert.throws(() => calculateOnlinePayoutPreview({ ...base, paymentReconciliationState: "PENDING" }));
});
