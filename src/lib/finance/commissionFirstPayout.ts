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
