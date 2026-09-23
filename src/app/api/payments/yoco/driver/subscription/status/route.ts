import { NextResponse } from "next/server";
import { getAuthenticatedDriver } from "@/lib/payments/driverServer";
import { isUuid } from "@/lib/payments/onlinePayment";

export async function GET(req: Request) {
  const auth = await getAuthenticatedDriver(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const attemptId = new URL(req.url).searchParams.get("attemptId");
  if (!isUuid(attemptId)) return NextResponse.json({ ok: false, error: "A valid payment attempt is required." }, { status: 400 });
  const { data: attempt, error } = await auth.supabaseAdmin.from("driver_subscription_online_payment_attempts")
    .select("state,amount_cents,currency,reconciliation_state,verified_at,plan")
    .eq("id", attemptId).eq("driver_id", auth.driverId).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: "Payment status is unavailable." }, { status: 503 });
  if (!attempt) return NextResponse.json({ ok: false, error: "Payment attempt not found." }, { status: 404 });
  return NextResponse.json({ ok: true, payment: {
    state: attempt.state, amountCents: Number(attempt.amount_cents), currency: attempt.currency,
    reconciliationState: attempt.reconciliation_state, verified: Boolean(attempt.verified_at),
    context: `MOOVU Driver ${attempt.plan} subscription`,
  } });
}
