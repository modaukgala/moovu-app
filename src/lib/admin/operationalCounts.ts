export type PaymentQueueRow = { payment_type?: string | null; status?: string | null };

export function paymentQueueCounts(rows: PaymentQueueRow[]) {
  return {
    pendingProofs: rows.filter((row) => row.status === "pending_payment_review").length,
    awaitingConfirmation: rows.filter((row) => row.status === "waiting_confirmation").length,
    subscriptionProofs: rows.filter((row) => row.status === "pending_payment_review" && (row.payment_type === "subscription" || row.payment_type === "combined")).length,
    commissionProofs: rows.filter((row) => row.status === "pending_payment_review" && (row.payment_type === "commission" || row.payment_type === "combined")).length,
  };
}

