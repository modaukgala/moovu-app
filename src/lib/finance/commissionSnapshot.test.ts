import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types requires explicit extensions.
import { readCommissionSnapshot } from "./commissionSnapshot.ts";

const trip = { commission_pct: 9.5, commission_amount: 9.5, driver_net_earnings: 90.5 };
const tx = { driver_id: "driver", amount: 9.5, direction: "debit", meta: { fare_amount: 100, commission_pct: 9.5, driver_net: 90.5 } };
test("existing historical rate is returned unchanged without current configuration", () => {
  const result = readCommissionSnapshot("driver", trip, tx);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.calc, { fareAmount: 100, commissionPct: 9.5, commissionAmount: 9.5, driverNet: 90.5 });
});
test("trip and ledger disagreement requires reconciliation", () => {
  assert.equal(readCommissionSnapshot("driver", { ...trip, commission_pct: 10 }, tx).ok, false);
  assert.equal(readCommissionSnapshot("driver", trip, { ...tx, amount: 10 }).ok, false);
});
test("missing legacy snapshot is not silently repriced", () => {
  assert.equal(readCommissionSnapshot("driver", trip, { ...tx, meta: null }).ok, false);
});
test("ownership and debit direction must match", () => {
  assert.equal(readCommissionSnapshot("another", trip, tx).ok, false);
  assert.equal(readCommissionSnapshot("driver", trip, { ...tx, direction: "credit" }).ok, false);
});
test("invalid and negative financial snapshot values fail closed", () => {
  for (const value of [NaN, Infinity, -1]) {
    assert.equal(readCommissionSnapshot("driver", trip, { ...tx, amount: value }).ok, false);
  }
});
