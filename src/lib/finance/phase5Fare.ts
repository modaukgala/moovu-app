import type { RideOptionId } from "../domain/fare";

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

/** Inputs other than route/ride option must come from server-checked membership and credit state. */
export function calculatePhase5Fare(input: {
  rideFareCents: number;
  rideOptionId: RideOptionId;
  activeMember: boolean;
  availableCreditCents: number;
}): Phase5Fare {
  if (!Number.isSafeInteger(input.rideFareCents) || input.rideFareCents <= 0) {
    throw new Error("Driver ride fare is invalid.");
  }
  if (!Number.isSafeInteger(input.availableCreditCents) || input.availableCreditCents < 0) {
    throw new Error("Promotional credit amount is invalid.");
  }
  const rideFareCents = input.rideFareCents;
  const grossServiceFeeCents = input.rideOptionId === "go"
    ? PHASE5_POLICY.goServiceFeeCents : PHASE5_POLICY.goXlServiceFeeCents;
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
