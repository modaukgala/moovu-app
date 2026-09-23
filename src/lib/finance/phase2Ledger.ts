// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { assertBalancedEntries, financialIdempotencyKey, ledgerEntry } from "./ledgerFoundation.ts";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { calculateCommissionCents } from "./phase2Policy.ts";

export type Phase2Journal = {
  idempotencyKey: string;
  entries: ReturnType<typeof ledgerEntry>[];
};

const platformCommissionRevenue = "PLATFORM:COMMISSION_REVENUE:ZAR";
const platformPaymentClearing = "PLATFORM:PAYMENT_CLEARING:ZAR";
const driverDebt = (driverId: string) => `DRIVER:${driverId}:COMMISSION_DEBT:ZAR`;
const driverCredit = (driverId: string) => `DRIVER:${driverId}:UNAPPLIED_CREDIT:ZAR`;

export function cashTripCommissionJournal(input: {
  tripId: string;
  driverId: string;
  finalFareCents: bigint;
  basisPoints?: bigint;
}): Phase2Journal {
  const amount = calculateCommissionCents(input.finalFareCents, input.basisPoints);
  if (amount <= BigInt(0)) throw new Error("Commission must be positive before posting.");
  const entries = [
    ledgerEntry(driverDebt(input.driverId), "DEBIT", amount),
    ledgerEntry(platformCommissionRevenue, "CREDIT", amount),
  ];
  assertBalancedEntries(entries);
  return { idempotencyKey: financialIdempotencyKey("trip_commission", input.tripId), entries };
}

export function driverPaymentJournal(input: {
  paymentId: string;
  driverId: string;
  paymentCents: bigint;
  debtCents: bigint;
}): Phase2Journal & { appliedCents: bigint; unappliedCents: bigint } {
  if (input.paymentCents <= BigInt(0)) throw new Error("Payment must be positive.");
  const debt = input.debtCents > BigInt(0) ? input.debtCents : BigInt(0);
  const appliedCents = input.paymentCents < debt ? input.paymentCents : debt;
  const unappliedCents = input.paymentCents - appliedCents;
  const entries = [ledgerEntry(platformPaymentClearing, "DEBIT", input.paymentCents)];
  if (appliedCents > BigInt(0)) entries.push(ledgerEntry(driverDebt(input.driverId), "CREDIT", appliedCents));
  if (unappliedCents > BigInt(0)) entries.push(ledgerEntry(driverCredit(input.driverId), "CREDIT", unappliedCents));
  assertBalancedEntries(entries);
  return {
    idempotencyKey: financialIdempotencyKey("driver_payment", input.paymentId),
    entries,
    appliedCents,
    unappliedCents,
  };
}
