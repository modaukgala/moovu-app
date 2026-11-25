import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { collectBoundedPages, chunkValues } from "@/lib/admin/boundedRetrieval";
import { readCommissionDebt } from "@/lib/admin/commissionDebt";
import { earningsPeriod, recordedSum, summariseTrips } from "@/lib/admin/earningsMetrics";
import { scanTrips, verifiedOnlineReceipts } from "@/lib/admin/earningsRead";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
  let period: ReturnType<typeof earningsPeriod>;
  try { period = earningsPeriod(new URL(req.url).searchParams); }
  catch { return NextResponse.json({ ok: false, error: "Choose a valid date range." }, { status: 400 }); }
  const db = auth.supabaseAdmin;
  async function receipts(table: "driver_settlements" | "driver_subscription_payments") {
    const result = await collectBoundedPages<{ amount_paid: number | null }>({
      pageSize: 500, maxRows: 10000, load: async (from, to) => {
        const query = await db.from(table).select("id,amount_paid").gte("created_at", period.start)
          .lt("created_at", period.end).order("id").range(from, to);
        if (query.error || !query.data) throw new Error("Receipts unavailable.");
        return query.data;
      },
    });
    return { value: result.complete ? recordedSum(result.rows.map((row) => row.amount_paid)) : null, complete: result.complete };
  }
  async function outstanding() {
    const drivers = await collectBoundedPages<{ id: string }>({
      pageSize: 200, maxRows: 2000, load: async (from, to) => {
        const result = await db.from("drivers").select("id").order("id").range(from, to);
        if (result.error || !result.data) throw new Error("Driver population unavailable.");
        return result.data;
      },
    });
    if (!drivers.complete) return { value: null, complete: false };
    const balances = [];
    for (const group of chunkValues(drivers.rows, 8)) {
      balances.push(...await Promise.all(group.map(({ id }) => readCommissionDebt((name, args) => db.rpc(name, args), id))));
    }
    return { value: recordedSum(balances.map((row) => row.balance_due)), complete: true };
  }
  async function memberships() {
    const payments = await collectBoundedPages<{ financial_transaction_id: string; amount_cents: number }>({
      pageSize: 500, maxRows: 10000, load: async (from, to) => {
        const result = await db.from("phase5_membership_payments").select("financial_transaction_id,amount_cents")
          .eq("status", "APPROVED").not("financial_transaction_id", "is", null)
          .gte("reviewed_at", period.start).lt("reviewed_at", period.end).order("id").range(from, to);
        if (result.error || !result.data) throw new Error("Membership receipts unavailable.");
        return result.data;
      },
    });
    if (!payments.complete) return { value: null, complete: false };
    const unique = new Map(payments.rows.map((row) => [row.financial_transaction_id, row.amount_cents]));
    let cents = 0;
    for (const ids of chunkValues([...unique.keys()], 100)) {
      const result = await db.from("financial_transactions").select("id").eq("transaction_state", "POSTED").in("id", ids);
      if (result.error || !result.data || result.data.length !== ids.length) throw new Error("Membership transaction evidence unavailable.");
      for (const row of result.data) {
        const value = unique.get(row.id);
        if (!Number.isSafeInteger(value)) throw new Error("Membership receipt amount unavailable.");
        cents += value!;
      }
    }
    return { value: cents / 100, complete: true };
  }
  const [trips, direct, subscriptions, membership, online, debt] = await Promise.all([
    scanTrips(db, period).catch(() => null), receipts("driver_settlements").catch(() => null),
    receipts("driver_subscription_payments").catch(() => null), memberships().catch(() => null),
    verifiedOnlineReceipts(db, period).catch(() => null), outstanding().catch(() => null),
  ]);
  return NextResponse.json({ ok: true, period, asOf: new Date().toISOString(),
    trips: trips?.complete ? summariseTrips(trips.rows) : null, tripsComplete: trips?.complete ?? null,
    direct, subscriptions, membership, online, debt,
    internalRecovery: null, totalSettled: null, grossPayout: null, netPayout: null,
    manualPayout: null, verifiedManualPayout: null, outstandingPayout: null,
  });
}
