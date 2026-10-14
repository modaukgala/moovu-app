import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { adminDriverName } from "@/lib/admin/identity";

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type DriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  online: boolean | null;
  busy: boolean | null;
  status: string | null;
  verification_status: string | null;
};

type WalletRow = { driver_id: string; balance_due: number | null; total_commission: number | null; total_driver_net: number | null; total_trips_completed: number | null; last_payment_at: string | null; last_payment_amount: number | null; account_status: string | null };

type SettlementRow = {
  driver_id: string | null;
  amount_paid: number | null;
  created_at: string | null;
};

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;

    const [{ data: drivers, error: driverError }, { data: wallets, error: walletError }, { data: settlements, error: settlementError }] =
      await Promise.all([
        supabaseAdmin
          .from("drivers")
          .select(`
            id,
            first_name,
            last_name,
            phone,
            online,
            busy,
            status,
            verification_status
          `)
          .order("first_name"),
        supabaseAdmin
          .from("driver_wallets")
          .select("driver_id,balance_due,total_commission,total_driver_net,total_trips_completed,last_payment_at,last_payment_amount,account_status"),
        supabaseAdmin
          .from("driver_settlements")
          .select(`
            id,
            driver_id,
            wallet_id,
            amount_paid,
            payment_method,
            reference,
            note,
            created_at
          `)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

    if (driverError) {
      return NextResponse.json({ ok: false, error: driverError.message }, { status: 500 });
    }

    if (walletError) {
      return NextResponse.json({ ok: false, error: walletError.message }, { status: 500 });
    }

    if (settlementError) {
      return NextResponse.json({ ok: false, error: settlementError.message }, { status: 500 });
    }

    const typedDrivers = (drivers ?? []) as DriverRow[];
    const walletByDriver = new Map(((wallets ?? []) as WalletRow[]).map((wallet) => [wallet.driver_id, wallet]));
    const typedSettlements = (settlements ?? []) as SettlementRow[];

    const settlementsByDriver = new Map<
      string,
      {
        last_payment_at: string | null;
        last_payment_amount: number | null;
      }
    >();

    for (const row of typedSettlements) {
      const driverId = String(row.driver_id ?? "").trim();
      if (!driverId) continue;

      const curr = settlementsByDriver.get(driverId) ?? {
        last_payment_at: null,
        last_payment_amount: null,
      };

      if (!curr.last_payment_at) {
        curr.last_payment_at = row.created_at ?? null;
        curr.last_payment_amount = num(row.amount_paid);
      }

      settlementsByDriver.set(driverId, curr);
    }

    const driverRows = typedDrivers.map((driver) => {
      const wallet = walletByDriver.get(driver.id);

      const settlementTotals = settlementsByDriver.get(driver.id) ?? {
        last_payment_at: null,
        last_payment_amount: null,
      };

      const balanceDue = num(wallet?.balance_due);

      return {
        id: driver.id,
        first_name: driver.first_name ?? null,
        last_name: driver.last_name ?? null,
        phone: driver.phone ?? null,
        online: driver.online ?? null,
        busy: driver.busy ?? null,
        status: driver.status ?? null,
        verification_status: driver.verification_status ?? null,
        wallet_summary: {
          balance_due: balanceDue,
          total_commission: num(wallet?.total_commission),
          total_driver_net: num(wallet?.total_driver_net),
          total_trips_completed: num(wallet?.total_trips_completed),
          total_paid: null,
          last_payment_at: wallet?.last_payment_at ?? settlementTotals.last_payment_at,
          last_payment_amount: wallet?.last_payment_amount ?? settlementTotals.last_payment_amount,
          account_status: wallet?.account_status ?? (balanceDue > 0 ? "due" : "settled"),
        },
      };
    });

    const driverNameById = new Map<string, string>();
    for (const d of typedDrivers) {
      driverNameById.set(d.id, adminDriverName(d));
    }

    const decoratedSettlements = typedSettlements.map((row) => ({
      ...row,
      driver_name: row.driver_id ? driverNameById.get(row.driver_id) ?? "Driver profile unavailable" : null,
    }));

    return NextResponse.json({
      ok: true,
      drivers: driverRows,
      settlements: decoratedSettlements,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
