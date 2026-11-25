export function splitPayout(grossCents: bigint, debtCents: bigint) {
  if (debtCents < BigInt(0)) throw new RangeError("Commission due cannot be negative");
  const availableCents = grossCents < BigInt(0) ? BigInt(0) : grossCents;
  const recoveredCents = availableCents < debtCents ? availableCents : debtCents;
  return {
    grossCents,
    recoveredCents,
    netCents: availableCents - recoveredCents,
    remainingCommissionCents: debtCents - recoveredCents,
    requiresReview: grossCents < BigInt(0),
  };
}

export function estimateCommissionFirstPayout(input: {
  customerPaymentCents: bigint;
  rideFareCents: bigint;
  commissionDueCents: bigint;
  rideOption: "go" | "go-xl";
}) {
  if (input.customerPaymentCents <= BigInt(0) || input.rideFareCents <= BigInt(0)) {
    throw new RangeError("Payment and ride fare must be positive");
  }
  const driverBookingShareCents = BigInt(100);
  const platformBookingShareCents = BigInt(input.rideOption === "go" ? 200 : 400);
  // Round the driver's 1.75% share once, half up, in cents.
  const driverPercentageFeeCents = (input.customerPaymentCents * BigInt(175) + BigInt(5000)) / BigInt(10000);
  const fixedFeeCents = BigInt(200);
  return {
    estimated: true as const,
    driverBookingShareCents,
    platformBookingShareCents,
    driverPercentageFeeCents,
    fixedFeeCents,
    ...splitPayout(input.rideFareCents + driverBookingShareCents - driverPercentageFeeCents - fixedFeeCents,
      input.commissionDueCents),
  };
}

/**
 * Arithmetic for a future allocation transaction. The caller must establish
 * independent fee evidence and read debt while holding the driver finance lock.
 */
export function calculateCommissionFirstAllocation(input: {
  customerPaymentCents: bigint;
  rideFareCents: bigint;
  bookingFeeCents: bigint;
  commissionDueCents: bigint;
  rideOption: "go" | "go-xl";
  providerFee: {
    percentageCents: bigint;
    fixedCents: bigint;
    recordedTotalCents: bigint;
  } | null;
}) {
  const zero = BigInt(0);
  const driverBookingShareCents = BigInt(100);
  const expectedBookingFee = BigInt(input.rideOption === "go" ? 300 : 500);
  if (input.rideFareCents <= zero || input.commissionDueCents < zero ||
      input.bookingFeeCents !== expectedBookingFee ||
      input.customerPaymentCents !== input.rideFareCents + input.bookingFeeCents) {
    throw new RangeError("Recorded fare and booking allocation do not reconcile");
  }
  const evidence = input.providerFee;
  if (!evidence) throw new RangeError("Independent provider fee evidence is required");
  const fixedFeeCents = BigInt(200);
  if (evidence.percentageCents < zero || evidence.fixedCents !== fixedFeeCents ||
      evidence.recordedTotalCents !== evidence.percentageCents + evidence.fixedCents ||
      evidence.recordedTotalCents > input.customerPaymentCents) {
    throw new RangeError("Recorded provider fee components do not reconcile");
  }
  const driverPercentageFeeCents = (evidence.percentageCents + BigInt(1)) / BigInt(2);
  return {
    driverBookingShareCents,
    platformBookingShareCents: input.bookingFeeCents - driverBookingShareCents,
    driverPercentageFeeCents,
    fixedFeeCents,
    ...splitPayout(input.rideFareCents + driverBookingShareCents - driverPercentageFeeCents - fixedFeeCents,
      input.commissionDueCents),
  };
}
