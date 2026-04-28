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

type CompletedTripRow = {
  id: string;
  fare_amount: number | null;
  commission_amount: number | null;
  driver_net_earnings: number | null;
  status: string | null;
};

type SettlementRow = {
  amount_paid: number | null;
};

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

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

async function ensureWallet(driverId: string) {
  const walletResult = await supabaseAdmin
    .from("driver_wallets")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();
  let wallet = walletResult.data;
  const walletFetchError = walletResult.error;

  if (walletFetchError) {
    return { wallet: null, error: walletFetchError.message };
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
        account_status: "settled",
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (walletCreateError || !newWallet) {
      return {
        wallet: null,
        error: walletCreateError?.message ?? "Failed to create driver wallet.",
      };
    }

    wallet = newWallet;
  }

  return { wallet, error: null };
}

async function recalcWallet(driverId: string, walletId: string) {
  const [
    { data: completedTrips, error: tripsError },
    { data: settlements, error: settlementsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("trips")
      .select("id,fare_amount,commission_amount,driver_net_earnings,status")
      .eq("driver_id", driverId)
      .eq("status", "completed"),
    supabaseAdmin
      .from("driver_settlements")
      .select("amount_paid")
      .eq("driver_id", driverId),
  ]);

  if (tripsError) {
    return { ok: false as const, error: tripsError.message };
  }

  if (settlementsError) {
    return { ok: false as const, error: settlementsError.message };
  }

  const completedTripRows = (completedTrips ?? []) as CompletedTripRow[];
  const settlementRows = (settlements ?? []) as SettlementRow[];

  const totalCommission = completedTripRows.reduce(
    (sum, row) => sum + num(row.commission_amount),
    0
  );

  const totalDriverNet = completedTripRows.reduce((sum, row) => {
    if (row.driver_net_earnings != null) {
      return sum + num(row.driver_net_earnings);
    }
    return sum + (num(row.fare_amount) - num(row.commission_amount));
  }, 0);

  const totalTripsCompleted = completedTripRows.length;

  const totalSettled = settlementRows.reduce(
    (sum, row) => sum + num(row.amount_paid),
    0
  );

  const balanceDue = Math.max(0, totalCommission - totalSettled);

  const { error: walletUpdateError } = await supabaseAdmin
    .from("driver_wallets")
    .update({
      balance_due: balanceDue,
      total_commission: totalCommission,
      total_driver_net: totalDriverNet,
      total_trips_completed: totalTripsCompleted,
      account_status: balanceDue > 0 ? "due" : "settled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", walletId);

  if (walletUpdateError) {
    return { ok: false as const, error: walletUpdateError.message };
  }

  return { ok: true as const };
}

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

  const walletResult = await ensureWallet(driverId);
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
    const recalcResult = await recalcWallet(driverId, wallet.id);
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
    description: `${calc.commissionPct}% commission charged on trip ${tripId}`,
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

  const recalcResult = await recalcWallet(driverId, wallet.id);
  if (!recalcResult.ok) {
    return { ok: false, error: recalcResult.error };
  }

  return { ok: true, skipped: false, calc };
}
