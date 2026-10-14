import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { resolveDriverFinanceAuthority } from "@/lib/finance/phase2DriverEligibility";

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type CompletedTripRow = {
  fare_amount: number | null;
  commission_amount: number | null;
  driver_net_earnings: number | null;
};

type SettlementRow = {
  amount_paid: number | null;
};

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
            balance_due,
            total_commission,
            total_driver_net,
            total_trips_completed,
            last_payment_at,
            last_payment_amount,
            account_status,
            updated_at
          `)
          .eq("driver_id", driverId)
          .maybeSingle(),
        supabaseAdmin
          .from("driver_wallet_transactions")
          .select("id,trip_id,tx_type,amount,direction,description,meta,created_at")
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

    const typedCompletedTrips = (completedTrips ?? []) as CompletedTripRow[];
    const typedSettlements = (settlements ?? []) as SettlementRow[];

    const recentSettled = typedSettlements.reduce((sum, row) => sum + num(row.amount_paid), 0);
    const finance = await resolveDriverFinanceAuthority(supabaseAdmin, { driverId, legacyBalanceDue: walletRow?.balance_due ?? null });
    if (!finance.ok) return NextResponse.json({ ok: false, error: finance.error }, { status: 503 });
    if (finance.authority.mode !== "AUTHORITATIVE" && walletRow?.balance_due == null) {
      return NextResponse.json({ ok: false, error: "Legacy wallet balance is unavailable." }, { status: 503 });
    }
    const balanceDue = finance.authority.netOwedCents / 100;

    return NextResponse.json({
      ok: true,
      wallet: {
        driver_id: driverId,
        balance_due: balanceDue,
        total_commission: walletRow?.total_commission ?? null,
        total_driver_net: walletRow?.total_driver_net ?? null,
        total_trips_completed: walletRow?.total_trips_completed ?? null,
        total_paid: null,
        recent_settled: recentSettled,
        cancellation_credits: null,
        threshold_percentage: null,
        last_payment_at: walletRow?.last_payment_at ?? null,
        last_payment_amount: walletRow?.last_payment_amount ?? null,
        account_status: balanceDue > 0 ? "due" : "settled",
        updated_at: walletRow?.updated_at ?? null,
      },
      finance_authority: finance.authority,
      transactions: txns ?? [],
      settlements: settlements ?? [],
      recent_completed_trips: typedCompletedTrips,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
