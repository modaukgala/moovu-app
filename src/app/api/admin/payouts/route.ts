import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { getDriverSettlement } from "@/lib/finance/driverSettlement";

/** Lists every active driver with their netted balance, payout due and bank details. */
export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) {
    return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
  }
  const db = auth.supabaseAdmin;
  const { data: drivers, error } = await db.from("drivers")
    .select("id,first_name,last_name,phone,status,online")
    .in("status", ["approved", "active"]).or("is_deleted.is.null,is_deleted.eq.false").limit(500);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const ids = (drivers ?? []).map((d) => d.id);
  const { data: banks } = ids.length
    ? await db.from("driver_payout_accounts").select("*").in("driver_id", ids)
    : { data: [] as Record<string, unknown>[] };
  const bankBy = new Map((banks ?? []).map((b) => [String(b.driver_id), b]));

  const rows = [];
  for (const d of drivers ?? []) {
    const s = await getDriverSettlement(db, d.id);
    if (!s.ok) continue;
    const st = s.settlement;
    if (st.cardEarningsCents === 0 && st.commissionDebtCents === 0 && st.paidOutCents === 0) continue;
    rows.push({ driver: d, settlement: st, bank: bankBy.get(d.id) ?? null });
  }
  rows.sort((a, b) => b.settlement.payoutDueCents - a.settlement.payoutDueCents
    || b.settlement.netOwedCents - a.settlement.netOwedCents);

  const { data: recent } = await db.from("driver_payouts")
    .select("id,driver_id,amount_cents,reference,paid_at,status").order("paid_at", { ascending: false }).limit(50);
  return NextResponse.json({ ok: true, rows, recentPayouts: recent ?? [] });
}
