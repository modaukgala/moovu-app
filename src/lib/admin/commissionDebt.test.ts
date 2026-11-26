import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner requires the extension.
import { readCommissionDebt } from "./commissionDebt.ts";

test("complete debt includes older payments and credits independently of history windows", async () => {
  const settlements = Array.from({ length: 240 }, (_, index) => index < 40 ? 5 : 2);
  const trips = Array.from({ length: 125 }, () => 10);
  const credit = 30;
  const rpc: Parameters<typeof readCommissionDebt>[0] = async (name, args) => {
    assert.equal(name, "phase05b_driver_debt");
    assert.deepEqual(args, { p_driver_id: "driver" });
    const paid = settlements.reduce((a, b) => a + b, 0);
    return { error: null, data: { driver_id: "driver", balance_due: 1250 - paid - credit,
      total_commission: 1250, total_driver_net: 5000, total_trips_completed: trips.length,
      cancellation_credits: credit, total_settled: paid } };
  };
  const wallet = await readCommissionDebt(rpc, "driver");
  const settlementSummary = await readCommissionDebt(rpc, "driver");
  assert.deepEqual(wallet, settlementSummary);
  assert.equal(wallet.balance_due, 620);
  assert.equal(wallet.total_settled, 600);
  assert.equal(wallet.total_trips_completed, 125);
});

test("failed and malformed debt reads reject", async () => {
  for (const response of [{ data: null, error: "offline" }, { data: { driver_id: "driver", balance_due: null }, error: null }]) {
    await assert.rejects(readCommissionDebt(async () => response, "driver"), /unavailable/);
  }
});
