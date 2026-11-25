import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { readCommissionDebt } from "@/lib/admin/commissionDebt";

const pageSize = 50;

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    if (!isFinancialAdminRole(auth.profile.role)) {
      return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
    }

    const params = new URL(req.url).searchParams;
    const driverPage = Number(params.get("driverPage") ?? 1);
    const settlementPage = Number(params.get("settlementPage") ?? 1);
    if ([driverPage, settlementPage].some((page) => !Number.isInteger(page) || page < 1 || page > 100000)) {
      return NextResponse.json({ ok: false, error: "Invalid page." }, { status: 400 });
    }

    const db = auth.supabaseAdmin;
    const [drivers, history] = await Promise.all([
      db.from("drivers").select("id,first_name,last_name,phone,online,busy,status,verification_status", { count: "exact" })
        .order("first_name").order("id").range((driverPage - 1) * pageSize, driverPage * pageSize - 1),
      db.from("driver_settlements").select("id,driver_id,wallet_id,amount_paid,payment_method,reference,note,created_at", { count: "exact" })
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range((settlementPage - 1) * pageSize, settlementPage * pageSize - 1),
    ]);
    if (drivers.error || history.error) {
      return NextResponse.json({ ok: false, error: "Commission settlement records are unavailable." }, { status: 503 });
    }

    const rows = drivers.data ?? [];
    const driverRows = [];
    for (let offset = 0; offset < rows.length; offset += 8) {
      driverRows.push(...await Promise.all(rows.slice(offset, offset + 8).map(async (driver) => {
        const [debt, latest] = await Promise.all([
          readCommissionDebt((name, args) => db.rpc(name, args), driver.id),
          db.from("driver_settlements").select("amount_paid,created_at").eq("driver_id", driver.id)
            .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
        ]);
        return { ...driver, wallet_summary: {
          balance_due: debt.balance_due,
          total_commission: debt.total_commission,
          total_driver_net: debt.total_driver_net,
          total_trips_completed: debt.total_trips_completed,
          total_paid: debt.total_settled,
          cancellation_credits: debt.cancellation_credits,
          last_payment_at: latest.error ? null : latest.data?.created_at ?? null,
          last_payment_amount: latest.error ? null : latest.data?.amount_paid ?? null,
          account_status: debt.balance_due > 0 ? "due" : "settled",
        } };
      })));
    }

    const settlementRows = history.data ?? [];
    const ids = [...new Set(settlementRows.map((row) => row.driver_id).filter(Boolean))];
    const names = ids.length
      ? await db.from("drivers").select("id,first_name,last_name").in("id", ids)
      : { data: [] };
    const byId = new Map((names.data ?? []).map((row) => [row.id, `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]));
    return NextResponse.json({
      ok: true,
      drivers: driverRows,
      settlements: settlementRows.map((row) => ({ ...row, driver_name: byId.get(row.driver_id) || "Driver profile unavailable" })),
      driverPagination: { page: driverPage, pageSize, total: drivers.count },
      settlementPagination: { page: settlementPage, pageSize, total: history.count },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Authoritative commission balances are unavailable." }, { status: 503 });
  }
}
