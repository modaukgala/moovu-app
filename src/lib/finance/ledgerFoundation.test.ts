import assert from "node:assert/strict";
import test from "node:test";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { assertBalancedEntries, financialIdempotencyKey, financialPayloadHash, ledgerEntry, PHASE1_LEDGER_READ_ENABLED, PHASE1_LEDGER_WRITE_ENABLED } from "./ledgerFoundation.ts";

test("the Phase 1 ledger cannot become a live source during Stage A", () => {
  assert.equal(PHASE1_LEDGER_WRITE_ENABLED, false);
  assert.equal(PHASE1_LEDGER_READ_ENABLED, false);
});

test("balanced cent entries are accepted and unbalanced entries fail", () => {
  assert.deepEqual(assertBalancedEntries([
    ledgerEntry("DRIVER:1:EARNINGS_CONTROL", "DEBIT", BigInt(6900)),
    ledgerEntry("DRIVER:1:EARNINGS_PAYABLE", "CREDIT", BigInt(6210)),
    ledgerEntry("PLATFORM:COMMISSION_REVENUE", "CREDIT", BigInt(690)),
  ]), { debitCents: BigInt(6900), creditCents: BigInt(6900) });
  assert.throws(() => assertBalancedEntries([
    ledgerEntry("A", "DEBIT", BigInt(100)),
    ledgerEntry("B", "CREDIT", BigInt(99)),
  ]));
});

test("payload hashing is deterministic and conflicting input changes the hash", () => {
  const first = financialPayloadHash({ source: "trip-1", amountCents: BigInt(6900), nested: { b: 2, a: 1 } });
  const retry = financialPayloadHash({ nested: { a: 1, b: 2 }, amountCents: BigInt(6900), source: "trip-1" });
  const conflict = financialPayloadHash({ source: "trip-1", amountCents: BigInt(7000), nested: { a: 1, b: 2 } });
  assert.equal(first, retry);
  assert.notEqual(first, conflict);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("idempotency keys are stable and reject missing identity", () => {
  assert.equal(financialIdempotencyKey("TRIP_FINANCIAL_COMPLETION", "ABC-123"), "trip_financial_completion:abc-123");
  assert.throws(() => financialIdempotencyKey("", "abc"));
});
