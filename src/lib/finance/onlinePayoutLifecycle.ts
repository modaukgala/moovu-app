export type PayoutStatus =
  | "DRAFT" | "RECONCILED" | "HELD" | "APPROVED"
  | "PAYMENT_RECORDED" | "PAID" | "FAILED" | "CANCELLED";

export type PayoutTransition = Readonly<{
  from: PayoutStatus;
  to: PayoutStatus;
  actorId: string;
  approvalActorId?: string | null;
  reason?: string | null;
  providerFeeVerified: boolean;
  paymentReconciled: boolean;
  refundOrDisputeOpen: boolean;
  approvedPolicyReference?: string | null;
  externalTransferReference?: string | null;
  externalEvidenceReference?: string | null;
  transferConfirmed: boolean;
}>;

const allowed: Record<PayoutStatus, readonly PayoutStatus[]> = {
  DRAFT: ["RECONCILED", "HELD", "CANCELLED"],
  RECONCILED: ["APPROVED", "HELD", "CANCELLED"],
  HELD: ["RECONCILED", "CANCELLED"],
  APPROVED: ["PAYMENT_RECORDED", "HELD"],
  PAYMENT_RECORDED: ["PAID", "FAILED"],
  FAILED: ["HELD"],
  PAID: [],
  CANCELLED: [],
};

/** Authorization and atomic posting also belong in the database transaction. */
export function assertOnlinePayoutTransition(input: PayoutTransition): void {
  if (!allowed[input.from].includes(input.to)) throw new Error("Invalid payout status transition.");
  if (!input.actorId.trim()) throw new Error("An authenticated Admin actor is required.");
  if ((input.to === "HELD" || input.to === "CANCELLED" || input.to === "FAILED") &&
    (input.reason?.trim().length ?? 0) < 3) {
    throw new Error("A reason is required for the payout exception.");
  }
  if (["RECONCILED", "APPROVED", "PAYMENT_RECORDED", "PAID"].includes(input.to) &&
    (!input.providerFeeVerified || !input.paymentReconciled || input.refundOrDisputeOpen)) {
    throw new Error("Provider fee, payment and refund state must reconcile.");
  }
  if (input.to === "APPROVED" && !input.approvedPolicyReference?.trim()) {
    throw new Error("A documented fee-sharing policy is required before approval.");
  }
  if (input.to === "PAYMENT_RECORDED" &&
    (!input.externalTransferReference?.trim() || !input.externalEvidenceReference?.trim())) {
    throw new Error("A verified external transfer reference and evidence are required.");
  }
  if (["PAYMENT_RECORDED", "PAID"].includes(input.to) &&
    input.approvalActorId === input.actorId) {
    throw new Error("Payment confirmation requires a second Admin actor.");
  }
  if (input.to === "PAID" && !input.transferConfirmed) {
    throw new Error("A confirmed bank transfer is required before PAID.");
  }
}
