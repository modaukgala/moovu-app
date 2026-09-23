import assert from "node:assert/strict";
import test from "node:test";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { assertBalancedEntries } from "./ledgerFoundation.ts";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { cashTripCommissionJournal, driverPaymentJournal } from "./phase2Ledger.ts";

test("cash trip recognizes commission only, not gross passenger cash", () => {
  const journal = cashTripCommissionJournal({ tripId: "trip-1", driverId: "driver-1", finalFareCents: BigInt(10_000) });
  assert.equal(journal.entries.length, 2);
  assert.equal(journal.entries[0].amountCents, BigInt(1_500));
  assert.ok(journal.entries.every((entry) => entry.amountCents !== BigInt(10_000)));
  assert.deepEqual(assertBalancedEntries(journal.entries), { debitCents: BigInt(1_500), creditCents: BigInt(1_500) });
});

test("payment allocates debt first and preserves excess as credit", () => {
  const journal = driverPaymentJournal({ paymentId: "payment-1", driverId: "driver-1", paymentCents: BigInt(7_000), debtCents: BigInt(5_000) });
  assert.equal(journal.appliedCents, BigInt(5_000));
  assert.equal(journal.unappliedCents, BigInt(2_000));
  assert.deepEqual(assertBalancedEntries(journal.entries), { debitCents: BigInt(7_000), creditCents: BigInt(7_000) });
});

test("partial payment never invents unapplied credit", () => {
  const journal = driverPaymentJournal({ paymentId: "payment-2", driverId: "driver-1", paymentCents: BigInt(1_000), debtCents: BigInt(5_000) });
  assert.equal(journal.appliedCents, BigInt(1_000));
  assert.equal(journal.unappliedCents, BigInt(0));
});
