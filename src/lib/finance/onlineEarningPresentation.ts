// @ts-expect-error Node strip-types runner requires the explicit extension.
import { calculateOptionBPayout, type OptionBFeeEvidence } from "./optionBPayout.ts";

export type CompletedOnlineTrip = Readonly<{
  id: string;
  driver_id: string;
  completed_at: string;
  phase5_policy_version: string | null;
  phase5_driver_fare_basis_cents: number | null;
  phase5_customer_total_cents: number | null;
  phase5_service_fee_cents: number | null;
  ride_option: string | null;
  phase5_membership_waiver_cents: number | null;
  phase5_credit_cents: number | null;
  commission_amount: number | null;
  final_fare: number | null;
  fare_amount: number | null;
}>;

export type MatchedOnlinePayment = Readonly<{
  id: string;
  trip_id: string;
  amount_cents: number;
  state: string;
  reconciliation_state: string;
  verified_at: string | null;
  payment_ledger_transaction_id: string | null;
}>;

export type FeeComponents = Readonly<{
  payment_attempt_id: string;
  actual_fee_cents: number;
  percentage_fee_cents: number | null;
  fixed_fee_cents: number | null;
  source_type: string;
  source_reference: string;
}>;

function integerCents(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

/** Builds read-only earnings cards. A card is never a posted financial liability. */
export function presentCompletedOnlineEarning(
  trip: CompletedOnlineTrip,
  attempt: MatchedOnlinePayment | undefined,
  evidence: FeeComponents | undefined,
  optionBEffectiveAt: string | null,
) {
  if (!attempt || attempt.trip_id !== trip.id || attempt.state !== "SUCCEEDED" ||
      attempt.reconciliation_state !== "MATCHED" || !attempt.verified_at ||
      !attempt.payment_ledger_transaction_id) return null;
  const fare = trip.phase5_policy_version ? trip.phase5_driver_fare_basis_cents :
    (trip.final_fare ?? trip.fare_amount) === null ? null :
      Math.round((trip.final_fare ?? trip.fare_amount ?? 0) * 100);
  const total = trip.phase5_policy_version ? trip.phase5_customer_total_cents : attempt.amount_cents;
  const commission = trip.commission_amount === null ? null : Math.round(trip.commission_amount * 100);
  if (!integerCents(fare) || !integerCents(total) || !integerCents(commission) ||
      attempt.amount_cents !== total || fare === 0 || commission > fare) {
    return { tripId: trip.id, driverId: trip.driver_id, completedAt: trip.completed_at,
      status: "RECONCILIATION_REQUIRED" as const, policyVersion: null, calculation: null };
  }
  const base = { tripId: trip.id, driverId: trip.driver_id, completedAt: trip.completed_at };
  if (!optionBEffectiveAt || Date.parse(trip.completed_at) < Date.parse(optionBEffectiveAt)) {
    return { ...base, status: "PENDING_LEGACY_PAYOUT" as const, policyVersion: "legacy",
      calculation: { rideFareCents: fare, commissionCents: commission,
        driverRideEarningsCents: fare - commission, confirmedPayableCents: null } };
  }
  if (trip.phase5_policy_version === null ||
      !((trip.ride_option === "go" && trip.phase5_service_fee_cents === 300) ||
        (trip.ride_option === "group" && trip.phase5_service_fee_cents === 500)) ||
      trip.phase5_membership_waiver_cents !== 0 || trip.phase5_credit_cents !== 0) {
    return { ...base, status: "RECONCILIATION_REQUIRED" as const, policyVersion: null, calculation: null };
  }
  const verifiedFee: OptionBFeeEvidence | null = evidence?.payment_attempt_id === attempt.id &&
    integerCents(evidence.percentage_fee_cents) && integerCents(evidence.fixed_fee_cents) &&
    evidence.percentage_fee_cents + evidence.fixed_fee_cents === evidence.actual_fee_cents &&
    (evidence.source_type === "PROVIDER_SETTLEMENT" || evidence.source_type === "PROVIDER_EXPORT")
    ? { percentageFeeCents: evidence.percentage_fee_cents, fixedFeeCents: evidence.fixed_fee_cents,
      source: evidence.source_type, reference: evidence.source_reference } : null;
  try {
    const calculation = calculateOptionBPayout({ customerTotalCents: total, rideFareCents: fare,
      lockedBookingFeeCents: trip.phase5_service_fee_cents, commissionCents: commission,
      authorizedDebtRecoveryCents: 0, verifiedFee });
    return { ...base, status: calculation.status, policyVersion: calculation.policyVersion,
      calculation };
  } catch {
    return { ...base, status: "RECONCILIATION_REQUIRED" as const, policyVersion: null, calculation: null };
  }
}
