import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types runner requires the explicit extension.
import { calculateOptionBPayout } from "./optionBPayout.ts";

const verifiedFee = { percentageFeeCents: 172, fixedFeeCents: 200,
  source: "PROVIDER_EXPORT" as const, reference: "synthetic-yoco-evidence" };

test("R49 reference reconciles without treating the example as production fee evidence", () => {
  const result = calculateOptionBPayout({ customerTotalCents: 4900, rideFareCents: 4600,
    lockedBookingFeeCents: 300, commissionCents: 690, authorizedDebtRecoveryCents: 0, verifiedFee });
  assert.equal(result.status, "VERIFIED_FOR_REVIEW");
  assert.equal(result.verified?.finalPayoutCents, 3724);
  assert.equal(result.verified?.moovuNetCents, 804);
  assert.equal(result.verified?.reconciliationCents, 4900);
  assert.equal(result.confirmedPayableCents, 3724);
});

test("R100 example separates the R3 booking fee and both provider fee components", () => {
  const result = calculateOptionBPayout({ customerTotalCents: 10000, rideFareCents: 9700,
    lockedBookingFeeCents: 300, commissionCents: 1455, authorizedDebtRecoveryCents: 0,
    verifiedFee: { ...verifiedFee, percentageFeeCents: 350 } });
  assert.equal(result.verified?.finalPayoutCents, 7970);
  assert.equal(result.verified?.moovuNetCents, 1480);
  assert.equal(result.verified?.reconciliationCents, 10000);
});

test("missing evidence exposes an estimate but never a confirmed payable", () => {
  const result = calculateOptionBPayout({ customerTotalCents: 4900, rideFareCents: 4600,
    lockedBookingFeeCents: 300, commissionCents: 690, authorizedDebtRecoveryCents: 0,
    verifiedFee: null });
  assert.equal(result.status, "PENDING_FEE_VERIFICATION");
  assert.equal(result.estimated.payoutBeforeDebtCents, 3724);
  assert.equal(result.verified, null);
  assert.equal(result.confirmedPayableCents, null);
});

test("odd cents allocate the extra percentage-fee cent to the Driver", () => {
  const result = calculateOptionBPayout({ customerTotalCents: 4900, rideFareCents: 4600,
    lockedBookingFeeCents: 300, commissionCents: 690, authorizedDebtRecoveryCents: 0,
    verifiedFee: { ...verifiedFee, percentageFeeCents: 173 } });
  assert.equal(result.verified?.driverPercentageFeeCents, 87);
  assert.equal(result.verified?.moovuPercentageFeeCents, 86);
  assert.equal(result.verified?.reconciliationCents, 4900);
  assert.equal(result.status, "RECONCILIATION_REQUIRED");
  assert.equal(result.confirmedPayableCents, null);
});

test("authorized debt is separate and cannot exceed payout", () => {
  const base = { customerTotalCents: 4900, rideFareCents: 4600,
    lockedBookingFeeCents: 300, commissionCents: 690, verifiedFee };
  const result = calculateOptionBPayout({ ...base, authorizedDebtRecoveryCents: 500 });
  assert.equal(result.verified?.payoutBeforeDebtCents, 3724);
  assert.equal(result.verified?.finalPayoutCents, 3224);
  assert.throws(() => calculateOptionBPayout({ ...base, authorizedDebtRecoveryCents: 3725 }));
});

test("rejects an invented booking fee, incorrect commission, unsafe inputs, or a negative payout", () => {
  const base = { customerTotalCents: 4900, rideFareCents: 4600,
    lockedBookingFeeCents: 300, commissionCents: 690, authorizedDebtRecoveryCents: 0, verifiedFee };
  assert.throws(() => calculateOptionBPayout({ ...base, lockedBookingFeeCents: 0 }));
  assert.throws(() => calculateOptionBPayout({ ...base, commissionCents: 735 }));
  assert.throws(() => calculateOptionBPayout({ ...base, customerTotalCents: 4900.5 }));
  assert.throws(() => calculateOptionBPayout({ ...base, verifiedFee: { ...verifiedFee, reference: "" } }));
  assert.throws(() => calculateOptionBPayout({ ...base, verifiedFee: { ...verifiedFee, fixedFeeCents: 4000 } }));
});
