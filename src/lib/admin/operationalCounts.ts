export type PaymentQueueRow = { payment_type?: string | null; status?: string | null };

export function paymentQueueCounts(rows: PaymentQueueRow[]) {
  return {
    pendingProofs: rows.filter((row) => row.status === "pending_payment_review").length,
    awaitingConfirmation: rows.filter((row) => row.status === "waiting_confirmation").length,
    subscriptionProofs: rows.filter((row) => row.status === "pending_payment_review" && (row.payment_type === "subscription" || row.payment_type === "combined")).length,
    commissionProofs: rows.filter((row) => row.status === "pending_payment_review" && (row.payment_type === "commission" || row.payment_type === "combined")).length,
  };
}


export const paymentQueueFilters = {
  pendingProofs: { status: "pending_payment_review", types: null },
  awaitingConfirmation: { status: "waiting_confirmation", types: null },
  subscriptionProofs: { status: "pending_payment_review", types: ["subscription", "combined"] },
  commissionProofs: { status: "pending_payment_review", types: ["commission", "combined"] },
} as const;
