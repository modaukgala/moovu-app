/** Option B calculation only. It never creates a payable or treats estimates as provider evidence. */
export const OPTION_B_POLICY_VERSION = "online-driver-payout-option-b-v1";

export type OptionBFeeEvidence = Readonly<{
  percentageFeeCents: number;
  fixedFeeCents: number;
  source: "PROVIDER_SETTLEMENT" | "PROVIDER_EXPORT";
  reference: string;
}>;

export type OptionBPayoutInput = Readonly<{
  customerTotalCents: number;
  rideFareCents: number;
  lockedBookingFeeCents: number;
  commissionCents: number;
  authorizedDebtRecoveryCents: number;
  verifiedFee: OptionBFeeEvidence | null;
}>;

function nonnegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be nonnegative integer cents.`);
  return value;
}

function roundRatio(value: number, numerator: number, denominator: number): number {
  const result = (BigInt(value) * BigInt(numerator) + BigInt(denominator / 2)) / BigInt(denominator);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Financial amount exceeds safe integer cents.");
  return Number(result);
}

export function calculateOptionBPayout(input: OptionBPayoutInput) {
  const customerTotalCents = nonnegative(input.customerTotalCents, "Customer total");
  const rideFareCents = nonnegative(input.rideFareCents, "Ride fare");
  const lockedBookingFeeCents = nonnegative(input.lockedBookingFeeCents, "Booking fee");
  const commissionCents = nonnegative(input.commissionCents, "Commission");
  const authorizedDebtRecoveryCents = nonnegative(input.authorizedDebtRecoveryCents, "Debt recovery");
  if (rideFareCents === 0 || lockedBookingFeeCents !== 300 ||
      customerTotalCents !== rideFareCents + lockedBookingFeeCents ||
      commissionCents !== roundRatio(rideFareCents, 15, 100)) {
    throw new Error("Locked Option B fare, R3 booking fee, and commission must reconcile.");
  }
  const driverBookingFeeCents = 100;
  const moovuBookingFeeCents = 200;
  const driverRideEarningsCents = rideFareCents - commissionCents;
  const driverEarningsBeforeProcessingCents = driverRideEarningsCents + driverBookingFeeCents;
  const expectedPercentageFeeCents = roundRatio(customerTotalCents, 35, 1000);
  const expectedFixedFeeCents = 200;
  const estimatedDriverPercentageFeeCents = roundRatio(expectedPercentageFeeCents, 1, 2);
  const estimatedPayoutBeforeDebtCents = driverEarningsBeforeProcessingCents -
    estimatedDriverPercentageFeeCents - expectedFixedFeeCents;
  const estimatedMoovuNetCents = commissionCents + moovuBookingFeeCents -
    (expectedPercentageFeeCents - estimatedDriverPercentageFeeCents);
  const estimated = {
    percentageFeeCents: expectedPercentageFeeCents,
    fixedFeeCents: expectedFixedFeeCents,
    driverPercentageFeeCents: estimatedDriverPercentageFeeCents,
    moovuPercentageFeeCents: expectedPercentageFeeCents - estimatedDriverPercentageFeeCents,
    payoutBeforeDebtCents: estimatedPayoutBeforeDebtCents,
    moovuNetCents: estimatedMoovuNetCents,
  };
  if (estimatedPayoutBeforeDebtCents < 0 ||
      estimatedPayoutBeforeDebtCents + estimatedMoovuNetCents +
        expectedPercentageFeeCents + expectedFixedFeeCents !== customerTotalCents) {
    throw new Error("Estimated payout does not reconcile.");
  }
  const base = { policyVersion: OPTION_B_POLICY_VERSION, customerTotalCents, rideFareCents,
    lockedBookingFeeCents, commissionCents, driverBookingFeeCents, moovuBookingFeeCents,
    driverRideEarningsCents, driverEarningsBeforeProcessingCents, estimated };
  if (!input.verifiedFee) return { ...base, status: "PENDING_FEE_VERIFICATION" as const,
    confirmedPayableCents: null, verified: null };
  const percentageFeeCents = nonnegative(input.verifiedFee.percentageFeeCents, "Verified percentage fee");
  const fixedFeeCents = nonnegative(input.verifiedFee.fixedFeeCents, "Verified fixed fee");
  if (!input.verifiedFee.reference.trim() ||
      !["PROVIDER_SETTLEMENT", "PROVIDER_EXPORT"].includes(input.verifiedFee.source)) {
    throw new Error("Provider evidence source and reference are required.");
  }
  // An odd percentage-fee cent belongs to the Driver. The remainder belongs to MOOVU.
  const driverPercentageFeeCents = roundRatio(percentageFeeCents, 1, 2);
  const moovuPercentageFeeCents = percentageFeeCents - driverPercentageFeeCents;
  const payoutBeforeDebtCents = driverEarningsBeforeProcessingCents - driverPercentageFeeCents - fixedFeeCents;
  if (payoutBeforeDebtCents < 0 || authorizedDebtRecoveryCents > payoutBeforeDebtCents) {
    throw new Error("Processing fees or authorized debt exceed Driver earnings.");
  }
  const finalPayoutCents = payoutBeforeDebtCents - authorizedDebtRecoveryCents;
  const moovuNetCents = commissionCents + moovuBookingFeeCents - moovuPercentageFeeCents;
  if (payoutBeforeDebtCents + moovuNetCents + percentageFeeCents + fixedFeeCents !== customerTotalCents) {
    throw new Error("Verified payout does not reconcile to the Customer payment.");
  }
  const feeDiscrepancy = percentageFeeCents !== expectedPercentageFeeCents || fixedFeeCents !== expectedFixedFeeCents;
  return { ...base, status: feeDiscrepancy ? "RECONCILIATION_REQUIRED" as const : "VERIFIED_FOR_REVIEW" as const,
    confirmedPayableCents: feeDiscrepancy ? null : finalPayoutCents, verified: {
    percentageFeeCents, fixedFeeCents, driverPercentageFeeCents, moovuPercentageFeeCents,
    payoutBeforeDebtCents, authorizedDebtRecoveryCents, finalPayoutCents, moovuNetCents,
    reconciliationCents: payoutBeforeDebtCents + moovuNetCents + percentageFeeCents + fixedFeeCents,
  } };
}
