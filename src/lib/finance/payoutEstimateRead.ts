import type { SupabaseClient } from "@supabase/supabase-js";
import { readCommissionDebt } from "../admin/commissionDebt";
import { estimateCommissionFirstPayout } from "./commissionFirstPayout";

export async function readPayoutEstimates(db: SupabaseClient, driverId: string, page: number) {
  const pageSize = 20;
  const [history, debt] = await Promise.all([
    db.from("trips").select("id,completed_at,ride_option,phase5_ride_fare_cents,phase5_service_fee_cents,phase5_customer_total_cents", { count: "exact" })
      .eq("driver_id", driverId).eq("status", "completed").eq("payment_method", "online")
      .order("completed_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1),
    readCommissionDebt((name, args) => db.rpc(name, args), driverId).catch(() => null),
  ]);
  if (history.error || !history.data || history.count == null) throw new Error("Online trip history unavailable.");
  const debtCents = debt ? Math.round(debt.balance_due * 100) : null;
  const rows = await Promise.all(history.data.map(async (trip) => {
    const unavailable = (reason: string) => ({ tripId: trip.id, completedAt: trip.completed_at, estimate: null, reason });
    const { data: payment, error } = await db.from("online_payment_attempts")
      .select("id,amount_cents,verified_at,provider_payment_id")
      .eq("trip_id", trip.id).eq("provider", "YOCO").eq("state", "SUCCEEDED").eq("currency", "ZAR").maybeSingle();
    if (error || !payment?.verified_at || !payment.provider_payment_id || !Number.isSafeInteger(payment.amount_cents) || payment.amount_cents <= 0) {
      return unavailable("Verified payment evidence unavailable.");
    }
    const events = await db.from("online_provider_events").select("id").eq("payment_attempt_id", payment.id)
      .eq("provider", "YOCO").eq("trust_state", "VERIFIED").eq("processing_state", "PROCESSED")
      .eq("raw_provider_status", "succeeded").limit(1);
    if (events.error || !events.data?.length) return unavailable("Verified provider event unavailable.");
    const fare = trip.phase5_ride_fare_cents;
    const fee = trip.phase5_service_fee_cents;
    const option = fee === 300 && trip.ride_option === "go" ? "go" :
      fee === 500 && trip.ride_option === "group" ? "go-xl" : null;
    if (!trip.completed_at || !option || !Number.isSafeInteger(fare) || fare <= 0 ||
        trip.phase5_customer_total_cents !== payment.amount_cents || fare + fee !== payment.amount_cents) {
      return unavailable("Historical fare and booking allocation evidence unavailable or incompatible.");
    }
    if (debtCents === null || !Number.isSafeInteger(debtCents) || debtCents < 0) return unavailable("Authoritative commission debt unavailable.");
    const estimate = estimateCommissionFirstPayout({ customerPaymentCents: BigInt(payment.amount_cents),
      rideFareCents: BigInt(fare), commissionDueCents: BigInt(debtCents), rideOption: option });
    return { tripId: trip.id, completedAt: trip.completed_at, reason: null, estimate: {
      customerPaymentCents: payment.amount_cents, fareCents: fare, driverBookingShareCents: Number(estimate.driverBookingShareCents),
      percentageFeeCents: Number(estimate.driverPercentageFeeCents), fixedFeeCents: Number(estimate.fixedFeeCents),
      grossCents: Number(estimate.grossCents), recoveryCents: Number(estimate.recoveredCents), netCents: Number(estimate.netCents),
      remainingCents: Number(estimate.remainingCommissionCents), requiresReview: estimate.requiresReview,
    } };
  }));
  return { driverId, page, pageSize, total: history.count, currentDebtCents: debtCents, rows,
    confirmedAllocation: null, manualPayment: null, bankVerification: null };
}
