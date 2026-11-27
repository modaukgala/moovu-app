import type { RideOptionId } from "../domain/fare";

/** PostgREST may return an empty composite object when no active policy row exists. */
export function phase5PolicyActive(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as { version?: unknown; active?: unknown };
  return typeof policy.version === "string" && policy.version.length > 0 && policy.active === true;
}

export const PHASE5_POLICY = Object.freeze({
  version: "phase5-owner-v1",
  currency: "ZAR",
  membershipPriceCents: 9900,
  membershipDays: 30,
  goServiceFeeCents: 300,
  goXlServiceFeeCents: 500,
  referrerRewardCents: 2000,
  refereeRewardCents: 1000,
  creditExpiryDays: 90,
  automaticRenewal: false,
});

export type Phase5Fare = Readonly<{
  policyVersion: string;
  rideOptionId: RideOptionId;
  rideFareCents: number;
  grossServiceFeeCents: number;
  membershipWaiverCents: number;
  promotionalCreditCents: number;
  customerTotalCents: number;
  driverFareBasisCents: number;
}>;

/** Validates the tiered booking fee rate returned by moovu_service_fee_tier_bps() (null = flat fee). */
export function phase5ServiceFeeTierBps(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const bps = Number(value);
  return Number.isInteger(bps) && bps >= 1 && bps <= 2000 ? bps : null;
}

/**
 * Booking fee: the flat policy fee, or when a tier rate is set, that rate of the ride fare rounded
 * UP to the next whole rand, whichever is higher. Must match phase5_create_trip in the database.
 */
export function phase5ServiceFeeCents(rideFareCents: number, rideOptionId: RideOptionId, tierBps?: number | null) {
  const flat = rideOptionId === "go" ? PHASE5_POLICY.goServiceFeeCents : PHASE5_POLICY.goXlServiceFeeCents;
  if (!tierBps) return flat;
  return Math.max(flat, Math.ceil((rideFareCents * tierBps) / 1_000_000) * 100);
}

/** Inputs other than route/ride option must come from server-checked membership and credit state. */
export function calculatePhase5Fare(input: {
  rideFareCents: number;
  rideOptionId: RideOptionId;
  activeMember: boolean;
  availableCreditCents: number;
  serviceFeeTierBps?: number | null;
}): Phase5Fare {
  if (!Number.isSafeInteger(input.rideFareCents) || input.rideFareCents <= 0) {
    throw new Error("Driver ride fare is invalid.");
  }
  if (!Number.isSafeInteger(input.availableCreditCents) || input.availableCreditCents < 0) {
    throw new Error("Promotional credit amount is invalid.");
  }
  const rideFareCents = input.rideFareCents;
  const grossServiceFeeCents = phase5ServiceFeeCents(rideFareCents, input.rideOptionId, input.serviceFeeTierBps);
  const membershipWaiverCents = input.activeMember ? grossServiceFeeCents : 0;
  const beforeCreditCents = rideFareCents + grossServiceFeeCents - membershipWaiverCents;
  const promotionalCreditCents = Math.min(beforeCreditCents, input.availableCreditCents);
  return {
    policyVersion: PHASE5_POLICY.version,
    rideOptionId: input.rideOptionId,
    rideFareCents,
    grossServiceFeeCents,
    membershipWaiverCents,
    promotionalCreditCents,
    customerTotalCents: beforeCreditCents - promotionalCreditCents,
    driverFareBasisCents: rideFareCents,
  };
}
