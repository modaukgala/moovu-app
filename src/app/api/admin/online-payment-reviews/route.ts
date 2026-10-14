import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { parsePaymentReviewFilters, type PaymentReviewRow } from "@/lib/payments/paymentReview";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) {
    return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
  }
  let filters;
  try { filters = parsePaymentReviewFilters(new URL(req.url).searchParams); }
  catch { return NextResponse.json({ ok: false, error: "Invalid payment review filters." }, { status: 400 }); }

  const { data, error } = await auth.supabaseAdmin.rpc("admin_yoco_payment_review", filters);
  if (error) {
    console.error("[online-payment-reviews] read model unavailable", { code: error.code });
    return NextResponse.json({ ok: false, error: "Payment review data is unavailable. Confirm the read-only review migration is installed." }, { status: 503 });
  }
  const report = data as { rows: PaymentReviewRow[]; total: number; page: number; limit: number } | null;
  if (!report || !Array.isArray(report.rows) || !Number.isSafeInteger(report.total)) {
    return NextResponse.json({ ok: false, error: "Payment review data is incomplete." }, { status: 503 });
  }
  const tripIds = [...new Set(report.rows.map((row) => row.trip_id).filter((id): id is string => Boolean(id)))];
  const offersByTrip = new Map<string, { driver_id: string; status: string; created_at: string; responded_at: string | null }[]>();
  let offerHistoryAvailable = true;
  if (tripIds.length) {
    const { data: offers, error: offerError, count } = await auth.supabaseAdmin.from("driver_trip_offers")
      .select("trip_id,driver_id,status,created_at,responded_at", { count: "exact" })
      .in("trip_id", tripIds).order("created_at", { ascending: false }).limit(500);
    offerHistoryAvailable = !offerError && count !== null && count <= 500;
    if (offerHistoryAvailable) for (const offer of offers ?? []) {
      const history = offersByTrip.get(offer.trip_id) ?? [];
      history.push(offer);
      offersByTrip.set(offer.trip_id, history);
    }
  }
  return NextResponse.json({ ok: true, rows: report.rows.map((row) => ({
    id: row.id, payer: row.payer, amount_cents: row.amount_cents,
    created_at: row.created_at, verified_at: row.verified_at,
    provider_payment_id: row.provider_payment_id,
    payment_status: row.payment_status, payment_state: row.state,
    fulfilment_status: row.fulfilment_status,
    trip_id: row.trip_id, trip_status: row.trip_status,
    driver_name: row.driver_id && row.offer_status === "accepted" ? row.driver_name : null,
    offers: row.trip_id ? offersByTrip.get(row.trip_id) ?? [] : [],
    offer_history_available: offerHistoryAvailable,
  })), total: report.total, page: report.page, limit: report.limit },
  { headers: { "Cache-Control": "private, no-store" } });
}
