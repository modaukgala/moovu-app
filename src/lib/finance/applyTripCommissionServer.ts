import { supabaseAdmin } from "@/lib/supabase/admin";
import { calculateCommission } from "@/lib/finance/commission";

type CommissionCalc = {
  fareAmount: number;
  commissionPct: number;
  commissionAmount: number;
  driverNet: number;
};

type ApplyTripCommissionServerResult =
  | { ok: true; skipped: boolean; calc: CommissionCalc }
  | { ok: false; error: string };

export async function applyTripCommissionServer(params: {
  tripId: string;
  driverId: string;
  fareAmount: number;
  createdBy?: string | null;
  commissionPct?: number;
}): Promise<ApplyTripCommissionServerResult> {
  const {
    tripId,
    driverId,
    fareAmount,
    createdBy = null,
    commissionPct = 5,
  } = params;

  const calc = calculateCommission(fareAmount, commissionPct);

  if (!calc.fareAmount || calc.fareAmount <= 0) {
    return { ok: false, error: "Invalid fare amount." };
  }

  const { data: existingTx, error: existingTxError } = await supabaseAdmin
    .from("driver_wallet_transactions")
    .select("id")
    .eq("trip_id", tripId)
    .eq("tx_type", "commission")
    .limit(1);

  if (existingTxError) {
    return { ok: false, error: existingTxError.message };
  }

  if (existingTx && existingTx.length > 0) {
    return { ok: true, skipped: true, calc };
  }

  let { data: wallet, error: walletFetchError } = await supabaseAdmin
    .from("driver_wallets")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (walletFetchError) {
    return { ok: false, error: walletFetchError.message };
  }

  if (!wallet) {
    const { data: newWallet, error: walletCreateError } = await supabaseAdmin
      .from("driver_wallets")
      .insert({
        driver_id: driverId,
        balance_due: 0,
        total_commission: 0,
        total_driver_net: 0,
        total_trips_completed: 0,
      })
      .select("*")
      .single();

    if (walletCreateError || !newWallet) {
      return {
        ok: false,
        error: walletCreateError?.message ?? "Failed to create driver wallet.",
      };
    }

    wallet = newWallet;
  }

  const { error: tripUpdateError } = await supabaseAdmin
    .from("trips")
    .update({
      commission_pct: calc.commissionPct,
      commission_amount: calc.commissionAmount,
      driver_net_earnings: calc.driverNet,
    })
    .eq("id", tripId);

  if (tripUpdateError) {
    return { ok: false, error: tripUpdateError.message };
  }

  const { error: txError } = await supabaseAdmin
    .from("driver_wallet_transactions")
    .insert({
      driver_id: driverId,
      wallet_id: wallet.id,
      trip_id: tripId,
      tx_type: "commission",
      amount: calc.commissionAmount,
      direction: "debit",
      description: `5% commission charged on trip ${tripId}`,
      meta: {
        fare_amount: calc.fareAmount,
        commission_pct: calc.commissionPct,
        driver_net: calc.driverNet,
      },
      created_by: createdBy,
    });

  if (txError) {
    return { ok: false, error: txError.message };
  }

  const { error: walletUpdateError } = await supabaseAdmin
    .from("driver_wallets")
    .update({
      balance_due: Number(wallet.balance_due || 0) + calc.commissionAmount,
      total_commission: Number(wallet.total_commission || 0) + calc.commissionAmount,
      total_driver_net: Number(wallet.total_driver_net || 0) + calc.driverNet,
      total_trips_completed: Number(wallet.total_trips_completed || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", wallet.id);

  if (walletUpdateError) {
    return { ok: false, error: walletUpdateError.message };
  }

  return { ok: true, skipped: false, calc };
}