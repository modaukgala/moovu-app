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
  const from = (page - 1) * PAGE_SIZE;
  const { data: drivers, count, error: driverError } = await auth.supabaseAdmin.from("drivers")
    .select("id,first_name,last_name,phone,status,online", { count: "exact" })
    .order("id").range(from, from + PAGE_SIZE - 1);
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
  for (let offset = 0; offset < ids.length; offset += 5) {
    const batch = (drivers ?? []).slice(offset, offset + 5);
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
  return NextResponse.json({ ok: true, rows, total_drivers: count, page, page_size: PAGE_SIZE,
    aggregate_outstanding_cents: null, aggregate_status: "unavailable_without_complete_authoritative_snapshot" },
    { headers: { "Cache-Control": "private, no-store" } });
}
