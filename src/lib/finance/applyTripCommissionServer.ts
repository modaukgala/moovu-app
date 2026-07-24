import { supabaseAdmin } from "@/lib/supabase/admin";
import { calculateCommission, resolveCommissionPct } from "@/lib/finance/commission";
import {
  ensureDriverWallet,
  recalculateDriverWalletServer,
} from "@/lib/finance/driverWalletLedger";

type CommissionCalc = {
  fareAmount: number;
  commissionPct: number;
  commissionAmount: number;
  driverNet: number;
};

type ApplyTripCommissionServerResult =
  | { ok: true; skipped: boolean; calc: CommissionCalc }
  | { ok: false; error: string };

async function resolveSafeCreatedBy(createdBy?: string | null) {
  const candidate = String(createdBy ?? "").trim();

  if (!candidate) return null;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", candidate)
    .maybeSingle();

  if (error || !data?.id) {
    return null;
  }

  return data.id as string;
}

export async function applyTripCommissionServer(params: {
  tripId: string;
  driverId: string;
  fareAmount: number;
  createdBy?: string | null;
  commissionPct?: number;
  rideOptionId?: string | null;
}): Promise<ApplyTripCommissionServerResult> {
  const {
    tripId,
    driverId,
    fareAmount,
    createdBy = null,
    commissionPct = null,
    rideOptionId = null,
  } = params;

  const calc = calculateCommission(
    fareAmount,
    resolveCommissionPct({ rideOptionId, commissionPct })
  );

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

  const walletResult = await ensureDriverWallet(driverId);
  if (walletResult.error || !walletResult.wallet) {
    return { ok: false, error: walletResult.error ?? "Failed to prepare driver wallet." };
  }

  const wallet = walletResult.wallet;

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

  if (existingTx && existingTx.length > 0) {
    const recalcResult = await recalculateDriverWalletServer(driverId);
    if (!recalcResult.ok) {
      return { ok: false, error: recalcResult.error };
    }
    return { ok: true, skipped: true, calc };
  }

  const safeCreatedBy = await resolveSafeCreatedBy(createdBy);

  const txPayload = {
    driver_id: driverId,
    wallet_id: wallet.id,
    trip_id: tripId,
    tx_type: "commission",
    amount: calc.commissionAmount,
    direction: "debit",
    description: `${calc.commissionPct}% MOOVU commission charged on trip ${tripId}`,
    meta: {
      fare_amount: calc.fareAmount,
      commission_pct: calc.commissionPct,
      driver_net: calc.driverNet,
    },
    created_by: safeCreatedBy,
  };

  const { error: txError } = await supabaseAdmin
    .from("driver_wallet_transactions")
    .insert(txPayload);

  if (txError) {
    return { ok: false, error: txError.message };
  }

  const recalcResult = await recalculateDriverWalletServer(driverId);
  if (!recalcResult.ok) {
    return { ok: false, error: recalcResult.error };
  }

  return { ok: true, skipped: false, calc };
}
