export type PaymentReviewStatus = "pending" | "verified-paid" | "failed" | "refund-review" | "unknown";
export type PaymentReviewFilter = PaymentReviewStatus | "all";
export type PaymentReviewFulfilment = "no-trip" | "awaiting-driver" | "allocated" | "in-progress" | "completed" | "cancelled";
export type PaymentReviewFulfilmentFilter = PaymentReviewFulfilment | "all" | "needs-review";

export type PaymentReviewRow = {
  id: string; payer: string; amount_cents: number; state: string;
  created_at: string; verified_at: string | null; provider_payment_id: string | null;
  payment_status: PaymentReviewStatus; fulfilment_status: PaymentReviewFulfilment | null;
  trip_id: string | null; trip_status: string | null; driver_id: string | null;
  offer_status: string | null; driver_name: string | null;
};

const STATUSES = new Set<PaymentReviewFilter>(["all", "pending", "verified-paid", "failed", "refund-review", "unknown"]);
const FULFILMENT = new Set<PaymentReviewFulfilmentFilter>(["all", "needs-review", "no-trip", "awaiting-driver", "allocated", "in-progress", "completed", "cancelled"]);

export function parsePaymentReviewFilters(params: URLSearchParams) {
  const from = Date.parse(params.get("from") ?? "");
  const to = Date.parse(params.get("to") ?? "");
  const status = (params.get("status") ?? "all") as PaymentReviewFilter;
  const fulfilment = (params.get("fulfilment") ?? "all") as PaymentReviewFulfilmentFilter;
  const search = (params.get("search") ?? "").trim();
  const page = Number(params.get("page") ?? "1");
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 366 * 86400000
    || !STATUSES.has(status) || !FULFILMENT.has(fulfilment) || search.length > 100
    || !Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error("Invalid review filters.");
  return { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString(),
    p_status: status, p_fulfilment: fulfilment, p_search: search, p_page: page, p_limit: 20 };
}
