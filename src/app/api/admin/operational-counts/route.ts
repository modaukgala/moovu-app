import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { paymentQueueCounts } from "@/lib/admin/operationalCounts";
import { PHASE6_NEEDS_REVIEW } from "@/lib/admin/applicationSummary";
import { readYocoFulfilment } from "@/lib/admin/yocoFulfilment";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const [paymentsRead, reviewsRead, fulfilmentRead] = await Promise.allSettled([
    auth.supabaseAdmin.from("driver_payment_requests").select("payment_type,status")
      .in("status", ["pending_payment_review", "waiting_confirmation"]),
    auth.supabaseAdmin.from("phase6_applications").select("id", { count: "exact", head: true })
      .in("status", [...PHASE6_NEEDS_REVIEW]),
    readYocoFulfilment(auth.supabaseAdmin).catch(() => null),
  ]);
  const payments = paymentsRead.status === "fulfilled" ? paymentsRead.value : null;
  const reviews = reviewsRead.status === "fulfilled" ? reviewsRead.value : null;
  const fulfilment = fulfilmentRead.status === "fulfilled" ? fulfilmentRead.value : null;
  return NextResponse.json({
    ok: true,
    role: auth.profile.role,
    generatedAt: new Date().toISOString(),
    paymentQueues: !payments || payments.error ? null : paymentQueueCounts(payments.data ?? []),
    paymentQueuesError: !payments || payments.error ? "Payment queue counts are unavailable." : null,
    pendingApplicationReviews: !reviews || reviews.error ? null : reviews.count,
    pendingApplicationReviewsError: !reviews || reviews.error ? "Application review count is unavailable." : null,
    yocoTripPaymentExceptions: fulfilment?.count ?? null,
    yocoTripPaymentExceptionsError: fulfilment?.complete ? null : "Complete Yoco fulfilment counts are unavailable.",
  }, { headers: { "Cache-Control": "no-store" } });
}
