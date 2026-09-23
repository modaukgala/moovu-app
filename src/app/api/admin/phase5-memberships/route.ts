import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Financial Admin required." }, { status: 403 });
  const { data, error } = await auth.supabaseAdmin.from("phase5_membership_payments")
    .select("id,customer_id,amount_cents,currency,method,reference,status,submitted_at,reviewed_at,reviewed_by,review_reason,financial_transaction_id")
    .order("submitted_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ ok: false, error: "Membership reviews are unavailable." }, { status: 503 });
  return NextResponse.json({ ok: true, payments: data });
}

export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Financial Admin required." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const paymentId = String(body?.paymentId ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  const action = String(body?.action ?? "approve").trim();
  if (!uuid.test(paymentId) || reason.length < 3 || reason.length > 500) {
    return NextResponse.json({ ok: false, error: "Payment and an approval reason are required." }, { status: 400 });
  }
  if (!['approve','reject'].includes(action)) return NextResponse.json({ ok: false, error: "Unsupported review action." }, { status: 400 });
  const { data, error } = await auth.supabaseAdmin.rpc(action === 'approve' ? "phase5_approve_membership_payment" : "phase5_reject_membership_payment", {
    p_payment_id: paymentId, p_actor_id: auth.user.id, p_reason: reason,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  return NextResponse.json({ ok: true, result: data });
}
