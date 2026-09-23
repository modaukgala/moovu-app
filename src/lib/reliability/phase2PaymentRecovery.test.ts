import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const { phase2FinanceState } = await import(new URL("../finance/phase2Policy.ts", import.meta.url).href);

// Execute the actual route with simulated RPC boundaries. Database atomicity is
// deliberately not claimed by these route tests and needs disposable SQL tests.
function harness(debt: number, payment: number, options: {
  mode?: string; role?: string | null; outbox?: boolean; crashAfterLegacy?: boolean;
} = {}) {
  let legacyEffects = 0;
  let shadowEffects = 0;
  let notifications = 0;
  let businessEvents = 0;
  let failShadow = true;
  let transportFailure = false;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const logs: { message: string; details: Record<string, unknown> }[] = [];
  const applied = Math.min(debt, payment);
  const excess = payment - applied;
  if (options.crashAfterLegacy) { legacyEffects = 1; businessEvents = 1; }
  const supabase = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: "driver-user" } }) }) }) }),
  };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/auth/admin": {
      requireAdminUser: async () => ({ ok: true, user: { id: "verified-owner" }, profile: { role: "role" in options ? options.role : "owner" }, supabaseAdmin: supabase }),
      isFinancialAdminRole: (role: string) => ["owner", "admin"].includes(role),
    },
    "@/lib/push-server": { sendPushSafe: async () => { notifications++; } },
    "@/lib/finance/phase2Policy": { phase2Mode: () => options.mode ?? "SHADOW" },
    "@/lib/notifications/outboxDelivery": { isOutboxDeliveryEnabled: () => options.outbox ?? false },
    "@/lib/server/hardenedRpc": { callHardenedRpc: async (_client: unknown, name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const replayed = legacyEffects > 0;
      if (!replayed) { legacyEffects++; businessEvents++; }
      return { ok: true, result: { request_id: "payment-1", driver_id: "driver-1", status: "approved", payment_type: "commission",
        commission_applied: applied, unapplied_excess: excess, subscription_applied: 0, replayed } };
    } },
    "@/lib/server/phase2Rpc": { callPhase2Rpc: async (_client: unknown, name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (transportFailure) throw new Error("Simulated transport outage");
      if (failShadow) return { ok: false, code: "operation_failed" };
      const replayed = shadowEffects > 0;
      if (!replayed) shadowEffects++;
      return { ok: true, result: { replayed } };
    } },
  };
  const source = readFileSync(new URL("../../app/api/admin/payment-reviews/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(compiled, {
    exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
    URL, console: {
      error: (message: string, details: Record<string, unknown>) => logs.push({ message, details }),
      info: (message: string, details: Record<string, unknown>) => logs.push({ message, details }),
      warn: () => undefined,
    },
  });
  return {
    calls, logs,
    recover: () => { failShadow = false; transportFailure = false; },
    disconnect: () => { transportFailure = true; },
    post: () => exports.POST!(new Request("http://localhost/api/admin/payment-reviews", {
      method: "POST", body: JSON.stringify({ requestId: "payment-1", action: "approve", actor_id: "forged", actor_role: "admin" }),
    })),
    state: () => ({ legacyEffects, shadowEffects, notifications, businessEvents,
      legacyDebt: debt - legacyEffects * applied,
      shadowDebt: debt - shadowEffects * applied,
      shadowCredit: shadowEffects * excess }),
  };
}

for (const [debt, payment] of [[40, 60], [59, 10]]) {
  test(`Actual payment route recovers R${payment} shadow payment against R${debt} debt`, async () => {
    const h = harness(debt, payment);
    assert.equal((await h.post()).status, 200);
    assert.equal(h.state().legacyEffects, 1);
    assert.equal(h.state().shadowEffects, 0);
    assert.equal(h.logs.at(-1)?.details.state, "unresolved");
    h.recover();
    assert.equal((await h.post()).status, 200);
    assert.equal((await h.post()).status, 200);
    assert.deepEqual(h.state(), { legacyEffects: 1, shadowEffects: 1, notifications: 1, businessEvents: 1,
      legacyDebt: Math.max(0, debt - payment), shadowDebt: Math.max(0, debt - payment), shadowCredit: Math.max(0, payment - debt) });
    assert.equal(h.logs.at(-1)?.details.state, "resolved");
    assert.equal(h.logs.at(-1)?.details.shadowReplayed, true);
    assert.equal(phase2FinanceState(BigInt(Math.round(h.state().shadowDebt * 100))).restricted, false);
    assert.ok(h.logs.every((row) => row.details.sourceKey === "driver_payment:payment-1"));
    const shadowCalls = h.calls.filter((call) => call.name === "phase2_post_verified_driver_payment");
    assert.equal(shadowCalls.length, 3);
    for (const call of shadowCalls) {
      assert.equal(call.args.p_request_id, "payment-1");
      assert.equal(call.args.p_actor_id, "verified-owner");
    }
  });
}

test("Concurrent route replays retry the same shadow source with simulated idempotent RPC", async () => {
  const h = harness(40, 60);
  await h.post(); h.recover();
  const responses = await Promise.all([h.post(), h.post()]);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(h.state().shadowEffects, 1);
  assert.equal(h.state().legacyEffects, 1);
  assert.equal(h.state().notifications, 1);
});

test("Retry after a crash between legacy commit and shadow call recovers posting", async () => {
  const h = harness(59, 10, { crashAfterLegacy: true, outbox: true }); h.recover();
  assert.equal((await h.post()).status, 200);
  assert.equal(h.state().shadowDebt, 49);
  assert.equal(h.state().legacyEffects, 1);
  assert.equal(h.state().businessEvents, 1);
  assert.equal(h.state().notifications, 0);
});

test("Thrown shadow transport error preserves successful approval and permits recovery", async () => {
  const h = harness(40, 60); h.disconnect();
  assert.equal((await h.post()).status, 200);
  assert.equal(h.logs.at(-1)?.details.code, "transport_failure");
  h.recover(); await h.post();
  assert.equal(h.state().shadowCredit, 20);
  assert.equal(h.state().notifications, 1);
});

test("OFF stays legacy, AUTHORITATIVE selects its atomic review, and unauthorized cases do not post", async () => {
  for (const mode of ["OFF", "AUTHORITATIVE"]) {
    const h = harness(40, 60, { mode });
    assert.equal((await h.post()).status, 200);
    assert.equal(h.calls.filter((call) => call.name === "phase2_post_verified_driver_payment").length, 0);
    assert.equal(h.state().legacyEffects, 1);
    assert.equal(h.calls[0]?.name, mode === "AUTHORITATIVE" ? "phase2_review_driver_payment" : "phase05b_review_driver_payment");
  }
  const subscription = harness(0, 0);
  await subscription.post();
  assert.equal(subscription.calls.filter((call) => call.name.startsWith("phase2_")).length, 0);
  for (const role of ["driver", "customer", "dispatcher", "support", "", "unknown", null, undefined]) {
    const h = harness(40, 60, { role });
    assert.equal((await h.post()).status, 403);
    assert.equal(h.calls.length, 0);
  }
});
