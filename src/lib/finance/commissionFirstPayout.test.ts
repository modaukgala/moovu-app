import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner requires the extension.
import { calculateCommissionFirstAllocation, estimateCommissionFirstPayout, splitPayout } from "./commissionFirstPayout.ts";

test("commission-first recovery is capped by available payout and debt", () => {
  for (const [gross, debt, recovery, net, remaining] of [
    [30, 15, 15, 15, 0], [100, 40, 40, 60, 0], [50, 50, 50, 0, 0],
    [30, 50, 30, 0, 20], [100, 0, 0, 100, 0], [0, 0, 0, 0, 0],
  ]) {
    const result = splitPayout(BigInt(gross * 100), BigInt(debt * 100));
    assert.deepEqual([result.recoveredCents, result.netCents, result.remainingCommissionCents],
      [recovery, net, remaining].map((amount) => BigInt(amount * 100)));
  }
});

test("approved Go example uses one rounded fee share and no separate trip deduction", () => {
  const input = { customerPaymentCents: BigInt(4900), rideFareCents: BigInt(4600),
    commissionDueCents: BigInt(690), rideOption: "go" as const };
  const result = estimateCommissionFirstPayout(input);
  assert.deepEqual([result.driverPercentageFeeCents, result.fixedFeeCents, result.grossCents,
    result.recoveredCents, result.netCents, result.remainingCommissionCents],
    [86, 200, 4414, 690, 3724, 0].map(BigInt));
  assert.equal(estimateCommissionFirstPayout({ ...input, customerPaymentCents: BigInt(200) }).driverPercentageFeeCents, BigInt(4));
  assert.equal(estimateCommissionFirstPayout({ ...input, rideOption: "go-xl" }).platformBookingShareCents, BigInt(400));
  assert.throws(() => estimateCommissionFirstPayout({ ...input, rideFareCents: BigInt(0) }), RangeError);
});

test("insufficient fee coverage requires review and leaves debt untouched", () => {
  const result = splitPayout(BigInt(-1), BigInt(50));
  assert.equal(result.requiresReview, true);
  assert.equal(result.netCents, BigInt(0));
  assert.equal(result.remainingCommissionCents, BigInt(50));
  assert.throws(() => splitPayout(BigInt(100), BigInt(-1)), RangeError);
});

test("allocation arithmetic uses reconciled fee components and preserves the approved Go breakdown", () => {
  const input = { customerPaymentCents: BigInt(4900), rideFareCents: BigInt(4600),
    bookingFeeCents: BigInt(300), commissionDueCents: BigInt(690), rideOption: "go" as const,
    providerFee: { percentageCents: BigInt(171), fixedCents: BigInt(200), recordedTotalCents: BigInt(371) } };
  const result = calculateCommissionFirstAllocation(input);
  assert.deepEqual([result.driverPercentageFeeCents, result.fixedFeeCents, result.grossCents,
    result.recoveredCents, result.netCents, result.remainingCommissionCents], [86, 200, 4414, 690, 3724, 0].map(BigInt));
  const xl = calculateCommissionFirstAllocation({ ...input, rideOption: "go-xl",
    customerPaymentCents: BigInt(5100), bookingFeeCents: BigInt(500) });
  assert.equal(xl.platformBookingShareCents, BigInt(400));
  assert.throws(() => calculateCommissionFirstAllocation({ ...input, providerFee: null }), /evidence/);
  assert.throws(() => calculateCommissionFirstAllocation({ ...input,
    providerFee: { ...input.providerFee, recordedTotalCents: BigInt(372) } }), /reconcile/);
  assert.throws(() => calculateCommissionFirstAllocation({ ...input, bookingFeeCents: BigInt(500) }), /reconcile/);
});
