import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { readCommissionDebt } from "@/lib/admin/commissionDebt";

type CompletedTripRow = {
  fare_amount: number | null;
  commission_amount: number | null;
  driver_net_earnings: number | null;
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

    if (!isFinancialAdminRole(auth.profile.role)) {
      return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
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

    const pages = ["transactionPage", "settlementPage", "tripPage"].map((key) => Number(url.searchParams.get(key) ?? 1));
    if (pages.some((page) => !Number.isInteger(page) || page < 1 || page > 100000)) {
      return NextResponse.json({ ok: false, error: "Invalid history page." }, { status: 400 });
    }
    const [transactionPage, settlementPage, tripPage] = pages;
    const pageSize = 20;
    const start = (page: number) => (page - 1) * pageSize;

    const [{ data: walletRow, error: walletErr }, { data: txns, count: transactionTotal, error: txErr }, { data: settlements, count: settlementTotal, error: settlementsErr }, { data: completedTrips, count: tripTotal, error: tripsErr }] =
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
          .select("id,trip_id,tx_type,amount,direction,description,meta,created_at", { count: "exact" })
          .eq("driver_id", driverId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }).range(start(transactionPage), start(transactionPage) + pageSize - 1),
        supabaseAdmin
          .from("driver_settlements")
          .select(`
            id,
            amount_paid,
            payment_method,
            reference,
            note,
            created_at
          `, { count: "exact" })
          .eq("driver_id", driverId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }).range(start(settlementPage), start(settlementPage) + pageSize - 1),
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
          `, { count: "exact" })
          .eq("driver_id", driverId)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }).range(start(tripPage), start(tripPage) + pageSize - 1),
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
    const debt = await readCommissionDebt((name, args) => supabaseAdmin.rpc(name, args), driverId);
    const balanceDue = debt.balance_due;

    return NextResponse.json({
      ok: true,
      wallet: {
        driver_id: driverId,
        balance_due: balanceDue,
        total_commission: debt.total_commission,
        total_driver_net: debt.total_driver_net,
        total_trips_completed: debt.total_trips_completed,
        total_paid: debt.total_settled,
        cancellation_credits: debt.cancellation_credits,
        threshold_percentage: null,
        last_payment_at: walletRow?.last_payment_at ?? null,
        last_payment_amount: walletRow?.last_payment_amount ?? null,
        account_status: balanceDue > 0 ? "due" : "settled",
        updated_at: walletRow?.updated_at ?? null,
      },
      pagination: { pageSize, transactionPage, transactionTotal, settlementPage, settlementTotal, tripPage, tripTotal },
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
