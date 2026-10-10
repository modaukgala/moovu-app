export type AdminPaymentReviewRow = {
  payment_type?: string | null;
  status?: string | null;
};

export function adminPaymentReviewCounts(rows: AdminPaymentReviewRow[]) {
  const active = rows.filter(row =>
    row.status === "pending_payment_review" || row.status === "waiting_confirmation");
  return {
    all: active.length,
    subscription: active.filter(row => row.payment_type === "subscription").length,
    commission: active.filter(row => row.payment_type === "commission").length,
    waiting: active.filter(row => row.status === "waiting_confirmation").length,
  };
}
