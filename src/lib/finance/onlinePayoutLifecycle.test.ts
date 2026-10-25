import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node strip-types tests require an explicit TypeScript extension.
import { assertOnlinePayoutTransition, type PayoutTransition } from "./onlinePayoutLifecycle.ts";

const base: PayoutTransition = {
  from: "DRAFT", to: "RECONCILED", actorId: "admin-a",
  approvalActorId: null, providerFeeVerified: true, paymentReconciled: true,
  refundOrDisputeOpen: false, transferConfirmed: false,
};
test("reconciliation requires actual provider fee and verified payment", () => {
  assert.doesNotThrow(() => assertOnlinePayoutTransition(base));
  assert.throws(() => assertOnlinePayoutTransition({ ...base, providerFeeVerified: false }));
  assert.throws(() => assertOnlinePayoutTransition({ ...base, paymentReconciled: false }));
  assert.throws(() => assertOnlinePayoutTransition({ ...base, refundOrDisputeOpen: true }));
});
test("approval requires a documented policy and never records payment", () => {
  assert.throws(() => assertOnlinePayoutTransition({ ...base, from: "RECONCILED", to: "APPROVED" }));
  assert.doesNotThrow(() => assertOnlinePayoutTransition({ ...base, from: "RECONCILED", to: "APPROVED", approvedPolicyReference: "owner-policy-2026" }));
  assert.throws(() => assertOnlinePayoutTransition({ ...base, from: "APPROVED", to: "PAID" }));
});
test("external payment needs evidence, a second actor and bank confirmation", () => {
  const payment: PayoutTransition = { ...base, from: "APPROVED", to: "PAYMENT_RECORDED", approvalActorId: "admin-a", actorId: "admin-b" };
  assert.throws(() => assertOnlinePayoutTransition(payment));
  assert.doesNotThrow(() => assertOnlinePayoutTransition({ ...payment, externalTransferReference: "bank-123", externalEvidenceReference: "statement-123" }));
  assert.throws(() => assertOnlinePayoutTransition({ ...payment, actorId: "admin-a", externalTransferReference: "bank-123", externalEvidenceReference: "statement-123" }));
  assert.throws(() => assertOnlinePayoutTransition({ ...payment, from: "PAYMENT_RECORDED", to: "PAID" }));
  assert.doesNotThrow(() => assertOnlinePayoutTransition({ ...payment, from: "PAYMENT_RECORDED", to: "PAID", transferConfirmed: true }));
});
test("refunds, chargebacks, failed transfer and duplicate completion fail closed", () => {
  assert.throws(() => assertOnlinePayoutTransition({ ...base, from: "APPROVED", to: "PAYMENT_RECORDED", refundOrDisputeOpen: true }));
  assert.throws(() => assertOnlinePayoutTransition({ ...base, from: "PAYMENT_RECORDED", to: "FAILED" }));
  assert.doesNotThrow(() => assertOnlinePayoutTransition({ ...base, from: "PAYMENT_RECORDED", to: "FAILED", reason: "Bank rejected" }));
  assert.throws(() => assertOnlinePayoutTransition({ ...base, from: "PAID", to: "PAID" }));
  assert.throws(() => assertOnlinePayoutTransition({ ...base, from: "CANCELLED", to: "DRAFT" }));
});
