import { NextResponse } from "next/server";
import { getAuthenticatedDriver } from "@/lib/payments/driverServer";
import { getDriverSettlement } from "@/lib/finance/driverSettlement";

export async function GET(req: Request) {
  const auth = await getAuthenticatedDriver(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const result = await getDriverSettlement(auth.supabaseAdmin, auth.driverId);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 503 });
  const { data: payouts } = await auth.supabaseAdmin.from("driver_payouts")
    .select("id,amount_cents,reference,paid_at,status").eq("driver_id", auth.driverId)
    .order("paid_at", { ascending: false }).limit(20);
  const { data: bank } = await auth.supabaseAdmin.from("driver_payout_accounts")
    .select("bank_name,account_number").eq("driver_id", auth.driverId).maybeSingle();
  return NextResponse.json({
    ok: true,
    settlement: result.settlement,
    payouts: payouts ?? [],
    bankOnFile: bank ? { bankName: bank.bank_name, last4: String(bank.account_number).slice(-4) } : null,
  });
}
