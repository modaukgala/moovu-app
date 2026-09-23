import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Actual completion service, simulated database boundaries; real locking requires PostgreSQL proof.
function harness(options: { mode?: string; authorized?: boolean; replayed?: boolean } = {}) {
  let failShadow = true;
  let shadowEffects = 0;
  let notifications = 0;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const logs: Record<string, unknown>[] = [];
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: { id: "trip-1", driver_id: "driver-1", status: "completed", final_fare: 100,
        financial_version: 1 },
    }) }) }) }),
  };
  const dependencies: Record<string, unknown> = {
    "@/lib/supabase/admin": { supabaseAdmin: client },
    "@/lib/server/hardenedRpc": { callHardenedRpc: async (_client: unknown, name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return options.authorized === false
        ? { ok: false, status: 403, error: "Unauthorized completion" }
        : { ok: true, result: { replayed: options.replayed ?? true } };
    } },
    "@/lib/server/phase2Rpc": { callPhase2Rpc: async (_client: unknown, name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      assert.equal(name, "phase2_claim_shadow_recovery_job");
      return { ok: true, result: { claimed: true, job: {
        id: "job-1", operation_key: "trip_commission:trip-1", trip_id: "trip-1",
        actor_id: "actor-1", status: "processing", attempts: 1,
      } } };
    } },
    "@/lib/finance/phase2ShadowRecovery": { processPhase2ShadowRecoveryJob: async (_client: unknown, job: { trip_id: string; actor_id: string }) => {
      calls.push({ name: "phase2_post_trip_commission", args: { p_trip_id: job.trip_id, p_actor_id: job.actor_id } });
      if (failShadow) return { ok: false, retryable: true, code: "transport_failure" };
      const replayed = shadowEffects > 0;
      if (!replayed) shadowEffects++;
      return { ok: true, replayed };
    } },
    "@/lib/finance/phase2Policy": { phase2Mode: () => options.mode ?? "SHADOW" },
    "@/lib/notifications/outboxDelivery": { isOutboxDeliveryEnabled: () => false },
    "@/lib/geo/tripGuards": {},
    "@/lib/trips/completionContract": { END_OTP_BYPASS_REASONS: [] },
    "@/lib/trips/lockedTripFare": {},
    "@/lib/push-notify": Object.fromEntries(["notifyAdmins", "notifyCustomerForTrip", "notifyDriverForTrip"]
      .map((name) => [name, async () => { notifications++; }])),
  };
  const source = readFileSync(new URL("../trips/completeTripServer.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { completeTripServer?: (params: Record<string, unknown>) => Promise<{ status: number }> } = {};
  vm.runInNewContext(compiled, { exports,
    require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
    console: { error: (_message: string, details: Record<string, unknown>) => logs.push(details),
      info: (_message: string, details: Record<string, unknown>) => logs.push(details) },
  });
  return { calls, logs,
    recover: () => { failShadow = false; },
    complete: (driverId = "driver-1") => exports.completeTripServer!({ tripId: "trip-1", actorId: "actor-1", driverId, mode: "otp" }),
    state: () => ({ shadowEffects, notifications }),
  };
}

test("Completed trip replay heals a failed shadow effect without repeating notifications", async () => {
  const h = harness();
  assert.equal((await h.complete()).status, 409);
  assert.equal(h.logs.at(-1)?.state, "unresolved");
  h.recover();
  assert.equal((await h.complete()).status, 409);
  assert.equal((await h.complete()).status, 409);
  assert.deepEqual(h.state(), { shadowEffects: 1, notifications: 0 });
  assert.equal(h.logs.at(-1)?.state, "resolved");
  assert.equal(h.logs.at(-1)?.shadowReplayed, true);
  assert.ok(h.logs.every((row) => row.sourceKey === "trip_commission:trip-1"));
  const shadowCalls = h.calls.filter((call) => call.name === "phase2_post_trip_commission");
  assert.equal(shadowCalls.length, 3);
  assert.ok(shadowCalls.every((call) => call.args.p_trip_id === "trip-1" && call.args.p_actor_id === "actor-1"));
});

test("Concurrent completed-trip recovery requests use the same simulated idempotent RPC", async () => {
  const h = harness(); h.recover();
  await Promise.all([h.complete(), h.complete()]);
  assert.deepEqual(h.state(), { shadowEffects: 1, notifications: 0 });
});

test("Completion recovery requires ownership and an authorized legacy replay", async () => {
  const wrongDriver = harness();
  assert.equal((await wrongDriver.complete("other-driver")).status, 403);
  assert.equal(wrongDriver.calls.length, 0);
  for (const options of [{ authorized: false }, { replayed: false }]) {
    const h = harness(options); h.recover(); await h.complete();
    assert.equal(h.calls.length, 1);
    assert.equal(h.state().shadowEffects, 0);
  }
});

test("Completed-trip recovery is disabled only when Phase 2 is OFF", async () => {
  const off = harness({ mode: "OFF" });
  assert.equal((await off.complete()).status, 409);
  assert.equal(off.calls.length, 0);
  const authoritative = harness({ mode: "AUTHORITATIVE" });
  assert.equal((await authoritative.complete()).status, 409);
  assert.equal(authoritative.calls.length, 3);
});
