import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { paymentQueueCounts } from "@/lib/admin/operationalCounts";
import { PHASE6_NEEDS_REVIEW } from "@/lib/admin/applicationSummary";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const [payments, reviews] = await Promise.all([
    auth.supabaseAdmin.from("driver_payment_requests").select("payment_type,status")
      .in("status", ["pending_payment_review", "waiting_confirmation"]),
    auth.supabaseAdmin.from("phase6_applications").select("id", { count: "exact", head: true })
      .in("status", [...PHASE6_NEEDS_REVIEW]),
  ]);
  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    paymentQueues: payments.error ? null : paymentQueueCounts(payments.data ?? []),
    paymentQueuesError: payments.error ? "Payment queue counts are unavailable." : null,
    pendingApplicationReviews: reviews.error ? null : reviews.count,
    pendingApplicationReviewsError: reviews.error ? "Application review count is unavailable." : null,
    yocoTripPaymentExceptions: null,
    yocoTripPaymentExceptionsError: "No supported Yoco trip-payment exception queue exists in this baseline.",
  }, { headers: { "Cache-Control": "no-store" } });
}
