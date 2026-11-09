import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Row = Record<string, unknown>;
type Result = { data: Row | null; error: { code: string } | null };
function load(file: string, dependencies: Record<string, unknown>) {
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", code)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const contract = load("src/lib/payments/yoco/checkoutContract.ts", {});
const CheckoutError = contract.YocoCheckoutError as new (message: string, outcome: string) => Error;

function fixture() {
  const driverId = randomUUID();
  const rows: Row[] = [];
  const state = { amount: 4245, authStatus: 200, mode: "AUTHORITATIVE", config: true,
    insertFails: false, providerCalls: 0, providerError: null as Error | null, bindingFails: false, releaseFails: false };
  const snapshot = () => ({ driverId, obligationType: "COMMISSION_DEBT", debtCents: state.amount,
    unappliedCreditCents: 0, netOwedCents: state.amount, policyId: "fixture-policy", financeMode: "AUTHORITATIVE", currency: "ZAR" });
  const version = () => createHash("sha256").update(JSON.stringify(snapshot())).digest("hex");
  const active = (row: Row) => ["CREATED", "PENDING", "RECONCILIATION_REQUIRED"].includes(String(row.state));
  class Query {
    filters: ((row: Row) => boolean)[] = [];
    inserted: Row | null = null;
    patch: Row | null = null;
    readonly table: string;
    constructor(table: string) { this.table = table; }
    select() { return this; }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this; }
    is(key: string, value: unknown) { this.filters.push(row => (row[key] ?? null) === value); return this; }
    insert(row: Row) { this.inserted = row; return this; }
    update(row: Row) { this.patch = row; return this; }
    result(): Result {
      if (this.table === "drivers") return { data: { id: driverId }, error: null };
      if (this.inserted) {
        if (state.insertFails) return { data: null, error: { code: "23514" } };
        if (rows.some(row => row.idempotency_key === this.inserted!.idempotency_key || active(row))) {
          return { data: null, error: { code: "23505" } };
        }
        rows.push(this.inserted);
        return { data: this.inserted, error: null };
      }
      const selected = rows.filter(row => this.filters.every(filter => filter(row)));
      if (this.patch) {
        if (state.releaseFails && this.patch.state === "FAILED") return { data: null, error: { code: "08006" } };
        if (state.bindingFails && this.patch.state === "PENDING") return { data: null, error: { code: "08006" } };
        for (const row of selected) Object.assign(row, this.patch);
      }
      return { data: selected[0] ?? null, error: selected.length > 1 ? { code: "PGRST116" } : null };
    }
    async maybeSingle() { return this.result(); }
    async single() { return this.result(); }
    then(resolve: (value: Result) => unknown) { return Promise.resolve(this.result()).then(resolve); }
  }
  const deps = {
    crypto: { createHash, randomUUID },
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/payments/driverServer": { getAuthenticatedDriver: async () => state.authStatus === 200
      ? { ok: true, driverId, supabaseAdmin: { from: (table: string) => new Query(table) } }
      : { ok: false, status: state.authStatus, error: "Session unavailable" } },
    "@/lib/finance/phase2DriverEligibility": { resolveDriverFinanceAuthority: async () => ({ ok: true, authority: {
      mode: state.mode, subscriptionRequired: false, debtCents: state.amount,
      unappliedCreditCents: 0, netOwedCents: state.amount, policyId: "fixture-policy" } }) },
    "@/lib/payments/yoco/client": {
      getYocoCheckoutConfiguration: () => { if (!state.config) throw Error("private config missing"); },
      createYocoCheckout: async (input: Row) => {
        state.providerCalls++;
        assert.equal(input.amountCents, state.amount);
        assert.match(String(input.idempotencyKey), /^moovu:checkout:[a-f0-9-]{36}$/);
        assert.match(String(input.successUrl), /^https:\/\/driver\.moovurides\.co\.za\/driver\/payment\/success/);
        if (state.providerError) throw state.providerError;
        return { id: "checkout_fixture", redirectUrl: "https://c.yoco.com/checkout/fixture", status: "created" };
      },
    },
    "@/lib/payments/yoco/checkoutContract": contract,
    "@/lib/maintenance/admission": { isAdmissionClosed: () => false },
  };
  const post = load("src/app/api/payments/yoco/driver/checkout/route.ts", deps).POST as (req: Request) => Promise<Response>;
  const request = () => post(new Request("https://moovurides.co.za/api/payments/yoco/driver/checkout", {
    method: "POST", body: JSON.stringify({ amountCents: 1, driverId: randomUUID() }),
  }));
  const historical = (status = "SUCCEEDED") => {
    const row = { id: randomUUID(), driver_id: driverId, obligation_type: "COMMISSION_DEBT", state: status, obligation_version: version(),
      amount_cents: state.amount, currency: "ZAR", idempotency_key: `yoco-driver-commission:${driverId}:${version()}`,
      provider_checkout_id: "checkout_old", provider_redirect_url: "https://c.yoco.com/checkout/old" };
    rows.push(row); return row;
  };
  return { state, rows, request, historical };
}

test("R42.45 can be paid again without reusing or changing the successful historical attempt", async () => {
  const f = fixture(); const old = f.historical(); const before = structuredClone(old);
  const response = await f.request(); assert.equal(response.status, 200);
  assert.deepEqual(old, before); assert.equal(f.rows.length, 2);
  assert.notEqual(f.rows[1].idempotency_key, old.idempotency_key);
  assert.ok(String(f.rows[1].idempotency_key).length <= 200);
  assert.equal(f.rows[1].amount_cents, 4245); assert.equal(f.rows[1].state, "PENDING");
  assert.equal(f.rows[1].verified_at, undefined);
});
test("concurrent taps have one reservation/provider call and later retries reuse the pending checkout", async () => {
  const f = fixture(); const responses = await Promise.all(Array.from({ length: 12 }, f.request));
  assert.ok(responses.some(row => row.status === 200));
  assert.equal(f.rows.length, 1); assert.equal(f.state.providerCalls, 1);
  const retried = await f.request(); assert.equal((await retried.json()).reused, true);
  assert.equal(f.state.providerCalls, 1);
});
for (const status of ["FAILED", "CANCELLED", "EXPIRED"]) {
  test(`terminal ${status} attempt does not block a new identical debt`, async () => {
    const f = fixture(); f.historical(status); assert.equal((await f.request()).status, 200);
    assert.equal(f.rows[0].state, status);
  });
}
for (const status of [401, 403]) test(`authentication/authorization ${status} never reserves or charges`, async () => {
  const f = fixture(); f.state.authStatus = status;
  assert.equal((await f.request()).status, status); assert.equal(f.rows.length, 0); assert.equal(f.state.providerCalls, 0);
});
test("zero debt cannot initiate payment", async () => {
  const f = fixture(); f.state.amount = 0; assert.equal((await f.request()).status, 409); assert.equal(f.rows.length, 0);
});
test("missing configuration does not poison the active-attempt slot", async () => {
  const f = fixture(); f.state.config = false;
  assert.equal((await f.request()).status, 503); assert.equal(f.rows.length, 0);
  f.state.config = true; assert.equal((await f.request()).status, 200);
});
test("database insertion failure never calls Yoco", async () => {
  const f = fixture(); f.state.insertFails = true;
  assert.equal((await f.request()).status, 503); assert.equal(f.state.providerCalls, 0);
});
test("definite provider rejection releases only its own attempt and permits a retry", async () => {
  const f = fixture(); f.state.providerError = new CheckoutError("Rejected", "NOT_CREATED");
  assert.equal((await f.request()).status, 503); assert.equal(f.rows[0].state, "FAILED");
  f.state.providerError = null; assert.equal((await f.request()).status, 200);
  assert.equal(f.rows.length, 2);
});
test("timeout/uncertain response retains the attempt and cannot create a second checkout", async () => {
  const f = fixture(); f.state.providerError = new CheckoutError("Timeout", "UNKNOWN");
  assert.equal((await f.request()).status, 503); assert.equal(f.rows[0].state, "CREATED");
  assert.equal((await f.request()).status, 409); assert.equal(f.state.providerCalls, 1);
});
test("failed reservation release requires review rather than promising a new checkout", async () => {
  const f = fixture(); f.state.providerError = new CheckoutError("Rejected", "NOT_CREATED"); f.state.releaseFails = true;
  const response = await f.request(); assert.equal((await response.json()).code, "PAYMENT_REVIEW_REQUIRED");
  assert.equal(f.rows[0].state, "CREATED"); assert.equal((await f.request()).status, 409);
  assert.equal(f.state.providerCalls, 1);
});
test("binding failure cannot create another provider checkout on retry", async () => {
  const f = fixture(); f.state.bindingFails = true;
  assert.equal((await f.request()).status, 500); assert.equal((await f.request()).status, 409);
  assert.equal(f.state.providerCalls, 1);
});
for (const change of ["amount", "url", "version"]) test(`pending checkout ${change} mismatch fails closed`, async () => {
  const f = fixture(); const row = f.historical("PENDING");
  if (change === "amount") row.amount_cents = 1;
  if (change === "url") row.provider_redirect_url = "https://untrusted.example";
  if (change === "version") row.obligation_version = "different";
  assert.equal((await f.request()).status, 409); assert.equal(f.state.providerCalls, 0);
});
test("reconciliation state cannot initiate another payment", async () => {
  const f = fixture(); f.historical("RECONCILIATION_REQUIRED");
  assert.equal((await f.request()).status, 409); assert.equal(f.state.providerCalls, 0);
});
