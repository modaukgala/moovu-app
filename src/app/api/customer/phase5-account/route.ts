import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";

export async function GET(req: Request) {
  const auth = await getAuthenticatedCustomer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const [state, payments, credits, redemptions, referral] = await Promise.all([
    auth.supabaseAdmin.rpc("phase5_customer_state", { p_customer_id: auth.customer.id }),
    auth.supabaseAdmin.from("phase5_membership_payments").select("id,amount_cents,reference,status,submitted_at,reviewed_at,review_reason").eq("customer_id", auth.customer.id).order("submitted_at", { ascending: false }).limit(20),
    auth.supabaseAdmin.from("phase5_credit_issuances").select("id,amount_cents,source_type,issued_at,expires_at,status").eq("customer_id", auth.customer.id).order("issued_at", { ascending: false }).limit(50),
    auth.supabaseAdmin.from("phase5_credit_redemptions").select("issuance_id,amount_cents").eq("customer_id", auth.customer.id),
    auth.supabaseAdmin.from("phase5_referral_relationships").select("id,status,created_at,qualified_at,referrer_customer_id,referee_customer_id").or(`referrer_customer_id.eq.${auth.customer.id},referee_customer_id.eq.${auth.customer.id}`).limit(20),
  ]);
  if ([state, payments, credits, redemptions, referral].some((result) => result.error)) {
    return NextResponse.json({ ok: false, error: "MOOVU+ account state is unavailable." }, { status: 503 });
  }
  const used = new Map<string, number>();
  for (const row of redemptions.data ?? []) used.set(row.issuance_id, (used.get(row.issuance_id) ?? 0) + Number(row.amount_cents));
  return NextResponse.json({
    ok: true,
    state: state.data,
    payments: payments.data,
    credits: (credits.data ?? []).map((row) => ({ ...row, remaining_cents: Math.max(0, Number(row.amount_cents) - (used.get(row.id) ?? 0)) })),
    referrals: referral.data,
  });
}

export async function POST(req: Request) {
  const auth = await getAuthenticatedCustomer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null);
  const action = String(body?.action ?? "");
  let rpc: string;
  let params: Record<string, unknown>;
  if (action === "ensure_referral_code") {
    rpc = "phase5_ensure_referral_code";
    params = { p_customer_id: auth.customer.id };
  } else if (action === "accept_referral") {
    const code = String(body?.code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,24}$/.test(code)) return NextResponse.json({ ok: false, error: "Enter a valid referral code." }, { status: 400 });
    rpc = "phase5_accept_referral";
    params = { p_referee_customer_id: auth.customer.id, p_code: code };
  } else if (action === "submit_membership_payment") {
    return NextResponse.json({ ok: false, error: "Manual bank-transfer membership submissions are no longer accepted." }, { status: 410 });
  } else {
    return NextResponse.json({ ok: false, error: "Unsupported account action." }, { status: 400 });
  }
  const { data, error } = await auth.supabaseAdmin.rpc(rpc, params);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  return NextResponse.json({ ok: true, result: data });
}
