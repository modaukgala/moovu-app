import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
// @ts-expect-error Node strip-types tests use the TypeScript source directly.
import { bankVerificationAvailable, manualPayoutsAvailable, payoutActionAllowed, payoutActivationMatches, payoutVisibilityAvailable } from "./onlinePayoutAvailability.ts";

type Result = { body: Record<string, unknown>; status: number };
type Query = { select: () => Query; order: () => Query; limit: () => Query; in: () => Query; gte: () => Query;
  eq: (column: string, value: string) => Query; maybeSingle: () => Promise<{ data: unknown; error: null }>;
  single: () => Promise<{ data: unknown; error: null }>;
  then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise<unknown> };

function query(data: unknown, onEq: (column: string, value: string) => void = () => {}): Query {
  return {
    select() { return this; }, order() { return this; }, limit() { return this; }, in() { return this; }, gte() { return this; },
    eq(column, value) { onEq(column, value); return this; },
    async maybeSingle() { return { data, error: null }; },
    async single() { return { data, error: null }; },
    then(resolve) { return Promise.resolve({ data, error: null }).then(resolve); },
  };
}

function loadRoute(relativePath: string, modules: Record<string, unknown>) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(compiled, { exports, process, require: (name: string) => modules[name] });
  return exports as { GET: (req: unknown) => Promise<Result>; POST: (req: unknown) => Promise<Result> };
}

const response = { NextResponse: { json: (body: Record<string, unknown>, options?: { status?: number }) =>
  ({ body, status: options?.status ?? 200 }) } };

test("Admin payout GET is read only and POST requires recording and independent verification gates", async () => {
  const original = [process.env.MOOVU_PAYOUT_VISIBILITY_ENABLED, process.env.MOOVU_MANUAL_PAYOUTS_ENABLED,
    process.env.MOOVU_PAYOUT_BANK_VERIFICATION_ENABLED];
  let reads = 0; let writes = 0;
  const admin = { from: (table: string) => { reads++; return query(table === "online_payout_policy" ?
    { effective_at: "2026-11-01T00:00:00+00:00" } : []); }, rpc: async () => {
    writes++; return { data: "ok", error: null };
  } };
  const route = loadRoute("../../app/api/admin/online-payouts/route.ts", {
    "next/server": response,
    "@/lib/auth/admin": { requireAdminUser: async () => ({ ok: true, profile: { role: "owner" },
      user: { id: "admin-1" }, supabaseAdmin: admin }), isFinancialAdminRole: () => true },
    "@/lib/finance/onlinePayoutAvailability": {
      bankVerificationAvailable, manualPayoutsAvailable, payoutActionAllowed, payoutVisibilityAvailable,
      payoutActivationMatches, payoutEffectiveAt: () => "2026-11-01T00:00:00.000Z",
    },
  });
  const request = (action: string) => ({ json: async () => ({ action,
    batchId: "a4500000-0000-4000-8000-000000000001",
    paymentId: "a4500000-0000-4000-8000-000000000002", reason: "reviewed" }) });
  try {
    delete process.env.MOOVU_PAYOUT_VISIBILITY_ENABLED;
    delete process.env.MOOVU_MANUAL_PAYOUTS_ENABLED;
    delete process.env.MOOVU_PAYOUT_BANK_VERIFICATION_ENABLED;
    assert.equal((await route.GET({})).body.available, false);
    assert.equal(reads, 0);
    process.env.MOOVU_PAYOUT_VISIBILITY_ENABLED = "true";
    const visible = await route.GET({});
    assert.equal(visible.body.available, true);
    assert.equal(visible.body.recordingEnabled, false);
    assert.ok(reads > 0);
    assert.equal(writes, 0);
    assert.equal((await route.POST(request("HOLD"))).status, 403);
    assert.equal(writes, 0);
    process.env.MOOVU_MANUAL_PAYOUTS_ENABLED = "true";
    assert.equal((await route.POST(request("HOLD"))).status, 200);
    assert.equal(writes, 1);
    assert.equal((await route.POST(request("VERIFY_MANUAL_PAYMENT"))).status, 403);
    assert.equal(writes, 1);
    process.env.MOOVU_PAYOUT_BANK_VERIFICATION_ENABLED = "true";
    assert.equal((await route.POST(request("VERIFY_MANUAL_PAYMENT"))).status, 200);
    assert.equal(writes, 2);
  } finally {
    const keys = ["MOOVU_PAYOUT_VISIBILITY_ENABLED", "MOOVU_MANUAL_PAYOUTS_ENABLED",
      "MOOVU_PAYOUT_BANK_VERIFICATION_ENABLED"] as const;
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    });
  }
});

test("Driver payout GET filters service-role reads to the authenticated Driver", async () => {
  const original = process.env.MOOVU_PAYOUT_VISIBILITY_ENABLED;
  const filters: Array<[string, string]> = [];
  let clientCount = 0;
  const route = loadRoute("../../app/api/driver/online-payouts/route.ts", {
    "next/server": response,
    "@/lib/finance/onlinePayoutAvailability": { payoutVisibilityAvailable, payoutActivationMatches,
      payoutEffectiveAt: () => "2026-11-01T00:00:00.000Z" },
    "@supabase/supabase-js": { createClient: () => {
      clientCount++;
      if (clientCount === 1) return { auth: { getUser: async () => ({ data: { user: { id: "user-a" } }, error: null }) } };
      return { from: (table: string) => query(table === "driver_accounts" ? { driver_id: "driver-a" } :
        table === "online_payout_policy" ? { effective_at: "2026-11-01T00:00:00+00:00" } :
        table === "online_driver_payables" ? [{ id: "payable-a", driver_id: "driver-a", trip_id: "trip-a",
          payment_attempt_id: "attempt-a", fare_cents: 10000, commission_cents: 1500,
          payable_cents: 8500, earned_at: "2026-11-02T00:00:00Z" }] :
        table === "trips" ? [{ id: "trip-a", phase5_service_fee_cents: 300 }] :
        table === "online_payout_fee_evidence" ? [{ payment_attempt_id: "attempt-a" }] : [],
        (column, value) => { if (table === "online_payout_batches" || table === "online_driver_payables") filters.push([column, value]); }),
        rpc: async () => ({ data: { commission_debt_cents: 0 }, error: null }) };
    } },
  });
  try {
    process.env.MOOVU_PAYOUT_VISIBILITY_ENABLED = "true";
    const result = await route.GET({ headers: new Headers({ Authorization: "Bearer controlled-test-token" }) });
    assert.equal(result.status, 200);
    assert.equal(result.body.available, true);
    assert.deepEqual(filters, [["driver_id", "driver-a"], ["driver_id", "driver-a"]]);
    assert.equal((result.body.eligiblePayables as Array<{ booking_fee_cents: number }>)[0].booking_fee_cents, 300);
    assert.deepEqual(result.body.verifiedFeeAttemptIds, ["attempt-a"]);
  } finally {
    if (original === undefined) delete process.env.MOOVU_PAYOUT_VISIBILITY_ENABLED;
    else process.env.MOOVU_PAYOUT_VISIBILITY_ENABLED = original;
  }
});
