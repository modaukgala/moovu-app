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
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { supabaseAdmin } = auth;
    const url = new URL(req.url);
    const driverId = String(url.searchParams.get("driverId") ?? "").trim();

    if (!driverId) {
      return NextResponse.json(
        { ok: false, error: "Missing driverId" },
        { status: 400 }
      );
    }

    const [{ data: walletRow, error: walletErr }, { data: txns, error: txErr }, { data: settlements, error: settlementsErr }, { data: completedTrips, error: tripsErr }] =
      await Promise.all([
        supabaseAdmin
          .from("driver_wallets")
          .select(`
            id,
            driver_id,
            last_payment_at,
            last_payment_amount,
            account_status,
            updated_at
          `)
          .eq("driver_id", driverId)
          .maybeSingle(),
        supabaseAdmin
          .from("driver_wallet_transactions")
          .select(`
            id,
            trip_id,
            tx_type,
            amount,
            created_at
          `)
          .eq("driver_id", driverId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabaseAdmin
          .from("driver_settlements")
          .select(`
            id,
            amount_paid,
            payment_method,
            reference,
            note,
            created_at
          `)
          .eq("driver_id", driverId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabaseAdmin
          .from("trips")
          .select(`
            id,
            fare_amount,
            commission_amount,
            driver_net_earnings,
            payment_method,
            pickup_address,
            dropoff_address,
            created_at,
            status
          `)
          .eq("driver_id", driverId)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

    if (walletErr) {
      return NextResponse.json({ ok: false, error: walletErr.message }, { status: 500 });
    }

    if (txErr) {
      return NextResponse.json({ ok: false, error: txErr.message }, { status: 500 });
    }

    if (settlementsErr) {
      return NextResponse.json({ ok: false, error: settlementsErr.message }, { status: 500 });
    }

    if (tripsErr) {
      return NextResponse.json({ ok: false, error: tripsErr.message }, { status: 500 });
    }

    const totalCommission = (completedTrips ?? []).reduce((sum: number, row: any) => sum + num(row.commission_amount), 0);
    const totalDriverNet = (completedTrips ?? []).reduce(
      (sum: number, row: any) =>
        sum +
        (row.driver_net_earnings != null
          ? num(row.driver_net_earnings)
          : num(row.fare_amount) - num(row.commission_amount)),
      0
    );
    const totalTripsCompleted = (completedTrips ?? []).length;
    const totalSettled = (settlements ?? []).reduce((sum: number, row: any) => sum + num(row.amount_paid), 0);
    const balanceDue = Math.max(0, totalCommission - totalSettled);

    if (walletRow?.id) {
      await supabaseAdmin
        .from("driver_wallets")
        .update({
          balance_due: balanceDue,
          total_commission: totalCommission,
          total_driver_net: totalDriverNet,
          total_trips_completed: totalTripsCompleted,
          account_status: balanceDue > 0 ? "due" : "settled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", walletRow.id);
    }

    return NextResponse.json({
      ok: true,
      wallet: {
        driver_id: driverId,
        balance_due: balanceDue,
        total_commission: totalCommission,
        total_driver_net: totalDriverNet,
        total_trips_completed: totalTripsCompleted,
        total_paid: totalSettled,
        last_payment_at: walletRow?.last_payment_at ?? null,
        last_payment_amount: walletRow?.last_payment_amount ?? null,
        account_status: balanceDue > 0 ? "due" : "settled",
        updated_at: walletRow?.updated_at ?? null,
      },
      transactions: txns ?? [],
      settlements: settlements ?? [],
      recent_completed_trips: completedTrips ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}