import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
// @ts-expect-error Node strip-types runner requires the explicit extension.
import { loadUnpostedOnlineEarnings } from "./onlineEarningReadModel.ts";

test("Driver earnings query is scoped before any financial records are read", async () => {
  const calls: Array<[string, string, unknown]> = [];
  const table = "trips";
  const chain = {
    select() { return this; },
    eq(column: string, value: unknown) { calls.push([table, column, value]); return this; },
    gte() { return this; },
    order() { return this; },
    limit() { return this; },
    then(resolve: (value: { data: never[]; error: null }) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(resolve);
    },
  };
  const client = { from(name: string) { assert.equal(name, "trips"); return chain; } } as unknown as SupabaseClient;
  assert.deepEqual(await loadUnpostedOnlineEarnings(client, "2026-11-01T00:00:00Z", null, "driver-a"), []);
  assert.ok(calls.some(([name, column, value]) =>
    name === "trips" && column === "driver_id" && value === "driver-a"));
});

test("a completed matched trip remains visible without fee evidence or a posted payable", async () => {
  const source: Record<string, unknown[]> = {
    trips: [{ id: "trip-a", driver_id: "driver-a", completed_at: "2026-11-03T10:00:00Z",
      phase5_policy_version: "synthetic-v1", phase5_driver_fare_basis_cents: 4600,
      phase5_customer_total_cents: 4900, phase5_service_fee_cents: 300, ride_option: "go",
      phase5_membership_waiver_cents: 0, phase5_credit_cents: 0,
      commission_amount: 6.9, final_fare: 49, fare_amount: 49 }],
    online_payment_attempts: [{ id: "attempt-a", trip_id: "trip-a", amount_cents: 4900,
      state: "SUCCEEDED", reconciliation_state: "MATCHED", verified_at: "2026-11-03T09:00:00Z",
      payment_ledger_transaction_id: "ledger-a", created_at: "2026-11-03T09:00:00Z" }],
    online_driver_payables: [], online_payment_refunds: [], online_payout_fee_evidence: [],
  };
  const client = { from(name: string) {
    assert.ok(name in source);
    const chain = {
      select() { return this; }, eq() { return this; }, gte() { return this; },
      order() { return this; }, limit() { return this; }, in() { return this; },
      then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: source[name], error: null }).then(resolve);
      },
    };
    return chain;
  } } as unknown as SupabaseClient;
  const rows = await loadUnpostedOnlineEarnings(client, "2026-11-01T00:00:00Z",
    "2026-11-02T00:00:00Z", "driver-a");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, "PENDING_FEE_VERIFICATION");
  assert.equal(rows[0]?.calculation?.confirmedPayableCents, null);
});
