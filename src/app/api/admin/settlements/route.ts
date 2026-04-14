import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;

    const [{ data: drivers, error: driverError }, { data: completedTrips, error: tripError }, { data: settlements, error: settlementError }] =
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
          .from("trips")
          .select(`
            id,
            driver_id,
            commission_amount,
            driver_net_earnings,
            fare_amount,
            status,
            created_at
          `)
          .eq("status", "completed"),
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

    if (tripError) {
      return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
    }

    if (settlementError) {
      return NextResponse.json({ ok: false, error: settlementError.message }, { status: 500 });
    }

    const tripsByDriver = new Map<
      string,
      {
        total_commission: number;
        total_driver_net: number;
        total_trips_completed: number;
      }
    >();

    for (const trip of completedTrips ?? []) {
      const driverId = String((trip as any).driver_id ?? "").trim();
      if (!driverId) continue;

      const curr = tripsByDriver.get(driverId) ?? {
        total_commission: 0,
        total_driver_net: 0,
        total_trips_completed: 0,
      };

      curr.total_commission += num((trip as any).commission_amount);
      curr.total_driver_net +=
        (trip as any).driver_net_earnings != null
          ? num((trip as any).driver_net_earnings)
          : num((trip as any).fare_amount) - num((trip as any).commission_amount);
      curr.total_trips_completed += 1;

      tripsByDriver.set(driverId, curr);
    }

    const settlementsByDriver = new Map<
      string,
      {
        total_paid: number;
        last_payment_at: string | null;
        last_payment_amount: number | null;
      }
    >();

    for (const row of settlements ?? []) {
      const driverId = String((row as any).driver_id ?? "").trim();
      if (!driverId) continue;

      const curr = settlementsByDriver.get(driverId) ?? {
        total_paid: 0,
        last_payment_at: null,
        last_payment_amount: null,
      };

      curr.total_paid += num((row as any).amount_paid);

      if (!curr.last_payment_at) {
        curr.last_payment_at = (row as any).created_at ?? null;
        curr.last_payment_amount = num((row as any).amount_paid);
      }

      settlementsByDriver.set(driverId, curr);
    }

    const driverRows = (drivers ?? []).map((driver: any) => {
      const tripTotals = tripsByDriver.get(driver.id) ?? {
        total_commission: 0,
        total_driver_net: 0,
        total_trips_completed: 0,
      };

      const settlementTotals = settlementsByDriver.get(driver.id) ?? {
        total_paid: 0,
        last_payment_at: null,
        last_payment_amount: null,
      };

      const balanceDue = Math.max(0, tripTotals.total_commission - settlementTotals.total_paid);

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
          total_commission: tripTotals.total_commission,
          total_driver_net: tripTotals.total_driver_net,
          total_trips_completed: tripTotals.total_trips_completed,
          total_paid: settlementTotals.total_paid,
          last_payment_at: settlementTotals.last_payment_at,
          last_payment_amount: settlementTotals.last_payment_amount,
          account_status: balanceDue > 0 ? "due" : "settled",
        },
      };
    });

    const driverNameById = new Map<string, string>();
    for (const d of drivers ?? []) {
      const fullName = `${(d as any).first_name ?? ""} ${(d as any).last_name ?? ""}`.trim();
      driverNameById.set((d as any).id, fullName || (d as any).phone || (d as any).id);
    }

    const decoratedSettlements = (settlements ?? []).map((row: any) => ({
      ...row,
      driver_name: driverNameById.get(row.driver_id) ?? row.driver_id,
    }));

    return NextResponse.json({
      ok: true,
      drivers: driverRows,
      settlements: decoratedSettlements,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}