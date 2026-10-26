import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { payoutVisibilityAvailable } from "@/lib/finance/onlinePayoutAvailability";

export async function GET(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: account, error: accountError } = await admin.from("driver_accounts")
    .select("driver_id").eq("user_id", user.id).maybeSingle();
  if (accountError || !account?.driver_id) {
    return NextResponse.json({ ok: false, error: "Driver account is not linked." }, { status: 403 });
  }
  if (!payoutVisibilityAvailable()) {
    return NextResponse.json({ ok: true, available: false, batches: [] },
      { headers: { "Cache-Control": "private, no-store" } });
  }
  const { data, error } = await admin.from("online_payout_batches")
    .select("id,period_start,period_end,status,fare_cents,current_commission_cents,driver_earnings_cents,actual_provider_fee_cents,driver_provider_fee_cents,prior_debt_recovery_cents,net_payout_cents,payout_method,approved_at,paid_at,created_at")
    .eq("driver_id", account.driver_id).order("created_at", { ascending: false }).limit(50);
  if (error) {
    console.error("[driver-online-payouts] read failed", { code: error.code });
    return NextResponse.json({ ok: false, error: "Online payouts are unavailable." }, { status: 503 });
  }
  const batchIds = (data ?? []).map(row => row.id);
  const manualPayments = batchIds.length > 0 ? await admin.from("online_payout_manual_payments")
    .select("id,batch_id,amount_cents,payment_at,method,bank_reference,state,recorded_at,verified_at")
    .in("batch_id", batchIds).order("recorded_at", { ascending: true })
    : { data: [], error: null };
  if (manualPayments.error) {
    return NextResponse.json({ ok: false, error: "Payment history is unavailable." }, { status: 503 });
  }
  const items = batchIds.length > 0 ? await admin.from("online_payout_items")
    .select("batch_id,id").in("batch_id", batchIds) : { data: [], error: null };
  if (items.error) {
    return NextResponse.json({ ok: false, error: "Payout trip counts are unavailable." }, { status: 503 });
  }
  const { data: financePosition, error: financeError } = await admin.rpc("phase2_driver_finance_position", {
    p_driver_id: account.driver_id,
  });
  if (financeError) {
    console.error("[driver-online-payouts] finance position failed", { code: financeError.code });
    return NextResponse.json({ ok: false, error: "Commission balance is unavailable." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, available: true, batches: data ?? [],
    manualPayments: manualPayments.data ?? [], items: items.data ?? [],
    remainingCommissionDebtCents: Number(financePosition?.commission_debt_cents ?? 0) },
    { headers: { "Cache-Control": "private, no-store" } });
}
