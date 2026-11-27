import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { resolveDriverFinanceAuthority } from "@/lib/finance/phase2DriverEligibility";

const PAGE_SIZE = 20;

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const page = Number(new URL(req.url).searchParams.get("page") ?? "1");
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) {
    return NextResponse.json({ ok: false, error: "Invalid page." }, { status: 400 });
  }
  // ?all=1 returns every (not deleted) driver so the page can sort by who owes the most.
  const all = new URL(req.url).searchParams.get("all") === "1";
  const from = all ? 0 : (page - 1) * PAGE_SIZE;
  let driverQuery = auth.supabaseAdmin.from("drivers")
    .select("id,first_name,last_name,phone,status,online", { count: "exact" })
    .order("id").range(from, all ? from + 999 : from + PAGE_SIZE - 1);
  if (all) driverQuery = driverQuery.or("is_deleted.is.null,is_deleted.eq.false");
  const { data: drivers, count, error: driverError } = await driverQuery;
  if (driverError || count == null) {
    return NextResponse.json({ ok: false, error: "Driver list is unavailable." }, { status: 503 });
  }
  const ids = (drivers ?? []).map((driver) => driver.id);
  const { data: wallets, error: walletError } = ids.length
    ? await auth.supabaseAdmin.from("driver_wallets")
      .select("driver_id,balance_due,total_commission,last_payment_at,last_payment_amount")
      .in("driver_id", ids)
    : { data: [], error: null };
  if (walletError) return NextResponse.json({ ok: false, error: "Wallet snapshots are unavailable." }, { status: 503 });
  const byDriver = new Map((wallets ?? []).map((wallet) => [wallet.driver_id, wallet]));

  const rows = [];
  const batchSize = all ? 10 : 5;
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = (drivers ?? []).slice(offset, offset + batchSize);
    const resolved = await Promise.all(batch.map(async (driver) => {
      const wallet = byDriver.get(driver.id);
      const finance = await resolveDriverFinanceAuthority(auth.supabaseAdmin, {
        driverId: driver.id, legacyBalanceDue: wallet?.balance_due ?? null,
      });
      if (!finance.ok) return null;
      if (!Number.isSafeInteger(finance.authority.netOwedCents)) return null;
      const missingLegacyBalance = finance.authority.mode !== "AUTHORITATIVE" && wallet?.balance_due == null;
      return {
        id: driver.id, first_name: driver.first_name, last_name: driver.last_name,
        phone: driver.phone, status: driver.status, online: driver.online,
        outstanding_cents: missingLegacyBalance ? null : finance.authority.netOwedCents,
        finance_mode: finance.authority.mode,
        finance_as_of: finance.authority.asOf,
        wallet_summary: {
          total_commission: wallet?.total_commission ?? null,
          last_payment_at: wallet?.last_payment_at ?? null,
          last_payment_amount: wallet?.last_payment_amount ?? null,
        },
      };
    }));
    if (resolved.some((row) => row === null)) {
      return NextResponse.json({ ok: false, error: "An authoritative commission balance is unavailable. No partial totals were returned." }, { status: 503 });
    }
    rows.push(...resolved);
  }
  if (all) {
    rows.sort((a, b) => Number(b?.outstanding_cents ?? -1) - Number(a?.outstanding_cents ?? -1));
    const known = rows.filter(r => r && r.outstanding_cents != null);
    return NextResponse.json({ ok: true, rows, total_drivers: count, page: 1, page_size: rows.length,
      aggregate_outstanding_cents: known.reduce((sum, r) => sum + Math.max(0, Number(r!.outstanding_cents)), 0),
      aggregate_status: known.length === rows.length ? "complete" : "partial" },
      { headers: { "Cache-Control": "private, no-store" } });
  }
  return NextResponse.json({ ok: true, rows, total_drivers: count, page, page_size: PAGE_SIZE,
    aggregate_outstanding_cents: null, aggregate_status: "unavailable_without_complete_authoritative_snapshot" },
    { headers: { "Cache-Control": "private, no-store" } });
}
