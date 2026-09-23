import { supabaseAdmin } from "@/lib/supabase/admin";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";

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
  const refreshed = await callHardenedRpc<{
    driver_id: string;
    total_commission: number;
    total_driver_net: number;
    total_trips_completed: number;
    total_settled: number;
    cancellation_credits: number;
    balance_due: number;
  }>(supabaseAdmin, "phase05b_refresh_driver_wallet", { p_driver_id: driverId });
  if (!refreshed.ok) return { ok: false as const, error: refreshed.error, code: refreshed.code };
  const totals = refreshed.result;
  const { data: wallet, error: walletError } = await supabaseAdmin.from("driver_wallets")
    .select("*").eq("driver_id", driverId).single();
  if (walletError || !wallet) return { ok: false as const, error: walletError?.message ?? "Wallet refresh returned no row." };
  return {
    ok: true as const,
    wallet,
    totals: {
      totalCommission: Number(totals.total_commission),
      totalDriverNet: Number(totals.total_driver_net),
      totalSettled: Number(totals.total_settled),
      cancellationCredits: Number(totals.cancellation_credits),
      balanceDue: Number(totals.balance_due),
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
