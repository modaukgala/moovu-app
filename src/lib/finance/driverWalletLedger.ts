import { supabaseAdmin } from "@/lib/supabase/admin";

type WalletTransaction = {
  amount: number | null;
  direction: string | null;
  tx_type: string | null;
};

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function ensureDriverWallet(driverId: string) {
  const current = await supabaseAdmin
    .from("driver_wallets")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (current.error) return { wallet: null, error: current.error.message };
  if (current.data) return { wallet: current.data, error: null };

  const created = await supabaseAdmin
    .from("driver_wallets")
    .insert({
      driver_id: driverId,
      balance_due: 0,
      total_commission: 0,
      total_driver_net: 0,
      total_trips_completed: 0,
      account_status: "settled",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  return {
    wallet: created.data ?? null,
    error: created.error?.message ?? null,
  };
}

export async function recalculateDriverWalletServer(driverId: string) {
  const walletResult = await ensureDriverWallet(driverId);
  if (!walletResult.wallet || walletResult.error) {
    return { ok: false as const, error: walletResult.error ?? "Could not prepare driver wallet." };
  }

  const [
    { data: completedTrips, error: tripsError },
    { data: settlements, error: settlementsError },
    { data: transactions, error: transactionError },
  ] = await Promise.all([
    supabaseAdmin
      .from("trips")
      .select("fare_amount,commission_amount,driver_net_earnings")
      .eq("driver_id", driverId)
      .eq("status", "completed"),
    supabaseAdmin
      .from("driver_settlements")
      .select("amount_paid")
      .eq("driver_id", driverId),
    supabaseAdmin
      .from("driver_wallet_transactions")
      .select("amount,direction,tx_type")
      .eq("driver_id", driverId),
  ]);

  const error = tripsError ?? settlementsError ?? transactionError;
  if (error) return { ok: false as const, error: error.message };

  const trips = completedTrips ?? [];
  const totalCommission = trips.reduce((sum, row) => sum + num(row.commission_amount), 0);
  const totalDriverNet = trips.reduce(
    (sum, row) =>
      sum +
      (row.driver_net_earnings != null
        ? num(row.driver_net_earnings)
        : num(row.fare_amount) - num(row.commission_amount)),
    0,
  );
  const totalSettled = (settlements ?? []).reduce((sum, row) => sum + num(row.amount_paid), 0);
  const cancellationCredits = ((transactions ?? []) as WalletTransaction[])
    .filter((row) => row.tx_type === "cancellation_credit" && row.direction === "credit")
    .reduce((sum, row) => sum + num(row.amount), 0);
  const balanceDue = Math.max(0, totalCommission - totalSettled - cancellationCredits);

  const { data: wallet, error: walletError } = await supabaseAdmin
    .from("driver_wallets")
    .update({
      balance_due: balanceDue,
      total_commission: totalCommission,
      total_driver_net: totalDriverNet + cancellationCredits,
      total_trips_completed: trips.length,
      account_status: balanceDue > 0 ? "due" : "settled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", walletResult.wallet.id)
    .select("*")
    .single();

  if (walletError) return { ok: false as const, error: walletError.message };
  return {
    ok: true as const,
    wallet,
    totals: {
      totalCommission,
      totalDriverNet,
      totalSettled,
      cancellationCredits,
      balanceDue,
    },
  };
}

export async function applyCancellationCreditServer(params: {
  tripId: string;
  driverId: string;
  amount: number;
  description?: string;
}) {
  const amount = Math.max(0, num(params.amount));
  if (amount <= 0) return { ok: true as const, skipped: true, amount: 0 };

  const walletResult = await ensureDriverWallet(params.driverId);
  if (!walletResult.wallet || walletResult.error) {
    return { ok: false as const, error: walletResult.error ?? "Could not prepare driver wallet." };
  }

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("driver_wallet_transactions")
    .select("id")
    .eq("trip_id", params.tripId)
    .eq("tx_type", "cancellation_credit")
    .limit(1);
  if (lookupError) return { ok: false as const, error: lookupError.message };

  if (!existing?.length) {
    const { error: insertError } = await supabaseAdmin
      .from("driver_wallet_transactions")
      .insert({
        driver_id: params.driverId,
        wallet_id: walletResult.wallet.id,
        trip_id: params.tripId,
        tx_type: "cancellation_credit",
        amount,
        direction: "credit",
        description:
          params.description ?? `Cancellation payout credited for trip ${params.tripId}`,
        meta: { source: "trip_cancellation_fee", reduces_commission_owed: true },
      });
    if (insertError) return { ok: false as const, error: insertError.message };
  }

  const recalculated = await recalculateDriverWalletServer(params.driverId);
  if (!recalculated.ok) return recalculated;
  return { ok: true as const, skipped: Boolean(existing?.length), amount, wallet: recalculated.wallet };
}
