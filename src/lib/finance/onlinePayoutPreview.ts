/** Calculation only. No payout, debt settlement, or provider fee posting occurs here. */
export type VerifiedYocoFee = Readonly<{
  totalCents: number;
  evidenceType: "PROVIDER_SETTLEMENT" | "PROVIDER_EXPORT";
  evidenceReference: string;
  vatTreatment: "TOTAL_INCLUDES_VAT" | "NO_VAT_CHARGED";
}>;

export type OnlinePayoutInput = Readonly<{
  tripStatus: string;
  paymentState: string;
  paymentReconciliationState: string;
  customerPaymentCents: number;
  commissionableFareCents: number;
  bookingFeeCents: number;
  bookingFeeAuthority: "LEGACY_EMBEDDED" | "PHASE5_SEPARATE";
  membershipWaiverCents: number;
  promotionalCreditCents: number;
  currentTripCommissionCents: number;
  previousCommissionDebtCents: number;
  verifiedYocoFee: VerifiedYocoFee | null;
  approvedDriverFeeShareBps: number | null;
}>;

export type OnlinePayoutPreview = Readonly<{
  status: "AWAITING_PROVIDER_FEE" | "AWAITING_FEE_POLICY" | "READY_FOR_REVIEW";
  customerPaymentCents: number;
  commissionableFareCents: number;
  bookingFeeCents: number;
  currentTripCommissionCents: number;
  driverTripEarningsCents: number;
  verifiedYocoFeeCents: number | null;
  driverYocoFeeShareCents: number | null;
  moovuYocoFeeShareCents: number | null;
  previousCommissionDebtCents: number;
  debtRecoveryCents: number | null;
  remainingPreviousDebtCents: number | null;
  netPayoutCents: number | null;
}>;

function cents(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be nonnegative integer cents.`);
  return value;
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Payout amount exceeds safe integer cents.");
  return Number(value);
}

function roundBasisPoints(value: number, basisPoints: number): number {
  return safeNumber((BigInt(value) * BigInt(basisPoints) + BigInt(5000)) / BigInt(10000));
}

export function calculateOnlinePayoutPreview(input: OnlinePayoutInput): OnlinePayoutPreview {
  if (input.tripStatus !== "completed" || input.paymentState !== "SUCCEEDED" ||
    input.paymentReconciliationState !== "MATCHED") {
    throw new Error("A completed trip and reconciled, unrefunded payment are required.");
  }
  const customerPaymentCents = cents(input.customerPaymentCents, "Customer payment");
  const commissionableFareCents = cents(input.commissionableFareCents, "Trip fare");
  const bookingFeeCents = cents(input.bookingFeeCents, "Booking fee");
  const membershipWaiverCents = cents(input.membershipWaiverCents, "Membership waiver");
  const promotionalCreditCents = cents(input.promotionalCreditCents, "Promotional credit");
  const currentTripCommissionCents = cents(input.currentTripCommissionCents, "Current commission");
  const previousCommissionDebtCents = cents(input.previousCommissionDebtCents, "Previous debt");
  if (commissionableFareCents <= 0 ||
    currentTripCommissionCents !== roundBasisPoints(commissionableFareCents, 1500)) {
    throw new Error("The locked fare and authoritative 15% commission do not reconcile.");
  }
  if (input.bookingFeeAuthority === "LEGACY_EMBEDDED") {
    if (bookingFeeCents !== 0 || membershipWaiverCents !== 0 || promotionalCreditCents !== 0 ||
      customerPaymentCents !== commissionableFareCents) {
      throw new Error("Legacy embedded fees cannot be separated or charged twice.");
    }
  } else if (input.bookingFeeAuthority === "PHASE5_SEPARATE") {
    if (membershipWaiverCents > bookingFeeCents ||
      promotionalCreditCents > commissionableFareCents + bookingFeeCents - membershipWaiverCents ||
      customerPaymentCents !== commissionableFareCents + bookingFeeCents - membershipWaiverCents - promotionalCreditCents) {
      throw new Error("The locked Phase 5 customer total does not reconcile.");
    }
  } else {
    throw new Error("Unknown booking-fee authority.");
  }

  const driverTripEarningsCents = commissionableFareCents - currentTripCommissionCents;
  const base = {
    customerPaymentCents, commissionableFareCents, bookingFeeCents,
    currentTripCommissionCents, driverTripEarningsCents, previousCommissionDebtCents,
  };
  const fee = input.verifiedYocoFee;
  if (!fee) return { ...base, status: "AWAITING_PROVIDER_FEE",
    verifiedYocoFeeCents: null, driverYocoFeeShareCents: null, moovuYocoFeeShareCents: null,
    debtRecoveryCents: null, remainingPreviousDebtCents: null, netPayoutCents: null };
  const verifiedYocoFeeCents = cents(fee.totalCents, "Yoco fee");
  if (!fee.evidenceReference.trim() ||
    !["PROVIDER_SETTLEMENT", "PROVIDER_EXPORT"].includes(fee.evidenceType) ||
    !["TOTAL_INCLUDES_VAT", "NO_VAT_CHARGED"].includes(fee.vatTreatment)) {
    throw new Error("Actual provider-fee evidence and VAT treatment are required.");
  }
  const shareBps = input.approvedDriverFeeShareBps;
  if (shareBps == null) return { ...base, status: "AWAITING_FEE_POLICY",
    verifiedYocoFeeCents, driverYocoFeeShareCents: null, moovuYocoFeeShareCents: null,
    debtRecoveryCents: null, remainingPreviousDebtCents: null, netPayoutCents: null };
  if (!Number.isSafeInteger(shareBps) || shareBps < 0 || shareBps > 10000) {
    throw new Error("Approved Yoco fee-share basis points are invalid.");
  }
  const driverYocoFeeShareCents = roundBasisPoints(verifiedYocoFeeCents, shareBps);
  const moovuYocoFeeShareCents = verifiedYocoFeeCents - driverYocoFeeShareCents;
  if (driverYocoFeeShareCents > driverTripEarningsCents) {
    throw new Error("Provider-fee share exceeds eligible Driver earnings.");
  }
  const debtRecoveryCents = Math.min(previousCommissionDebtCents,
    driverTripEarningsCents - driverYocoFeeShareCents);
  return { ...base, status: "READY_FOR_REVIEW", verifiedYocoFeeCents,
    driverYocoFeeShareCents, moovuYocoFeeShareCents, debtRecoveryCents,
    remainingPreviousDebtCents: previousCommissionDebtCents - debtRecoveryCents,
    netPayoutCents: driverTripEarningsCents - driverYocoFeeShareCents - debtRecoveryCents };
}
