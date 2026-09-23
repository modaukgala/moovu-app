import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("durable migration atomically enqueues OTP, bypass and Admin completions", () => {
  const sql = source("../../../docs/phase-2-durable-shadow-recovery.sql");
  assert.match(sql, /create table if not exists public\.phase2_shadow_recovery_jobs/);
  assert.match(sql, /status text not null default 'pending'/);
  assert.match(sql, /attempts integer not null default 0 check\(attempts between 0 and 8\)/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /phase2_enqueue_shadow_trip_recovery\(t\.id,p_actor_id,v_event\)/);
  assert.equal((sql.match(/phase2_enqueue_shadow_trip_recovery\(t\.id,p_actor_id,v_event\)/g) ?? []).length, 2);
  assert.match(sql, /p_mode not in \('otp','bypass','admin'\)/);
  assert.match(sql, /phase5_driver_fare_basis_cents::numeric\/100/);
  assert.match(sql, /phase5_post_service_fee\(t\.id,p_actor_id\)/);
  assert.match(sql, /phase5_qualify_referral\(t\.id,p_actor_id\)/);
});

test("queue and RPCs remain service-role-only with bounded terminal state", () => {
  const sql = source("../../../docs/phase-2-durable-shadow-recovery.sql");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.phase2_shadow_recovery_jobs from public,anon,authenticated,service_role/);
  assert.match(sql, /grant select on public\.phase2_shadow_recovery_jobs to service_role/);
  assert.equal((sql.match(/auth\.role\(\) is distinct from 'service_role'/g) ?? []).length, 4);
  assert.match(sql, /p_retryable and v_job\.attempts<8 then 'retryable_failure' else 'terminal_failure'/);
  assert.match(sql, /least\(3600,30\*\(2\^greatest\(0,attempts-1\)\)::integer\)/);
});

test("runtime claims durable work before posting and cron is secret protected", () => {
  const completion = source("../trips/completeTripServer.ts");
  const worker = source("../../app/api/jobs/phase2-shadow-recovery/route.ts");
  const config = JSON.parse(source("../../../vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
  assert.ok(completion.indexOf("phase2_claim_shadow_recovery_job") < completion.lastIndexOf("processPhase2ShadowRecoveryJob"));
  assert.match(worker, /process\.env\.CRON_SECRET/);
  assert.match(worker, /phase2Mode\(\) === "OFF"/);
  assert.match(worker, /phase2_claim_shadow_recovery_jobs/);
  assert.deepEqual(config.crons, [
    { path: "/api/jobs/phase2-shadow-recovery", schedule: "0 2 * * *" },
    { path: "/api/jobs/online-payment-dispatch", schedule: "* * * * *" },
  ]);
});

function recoveryHarness(posting: Record<string, unknown> | Error) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const dependencies: Record<string, unknown> = {
    "@/lib/server/phase2Rpc": {
      callPhase2Rpc: async (_client: unknown, name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "phase2_post_trip_commission") {
          if (posting instanceof Error) throw posting;
          return posting;
        }
        return { ok: true, result: { contract_version: "phase-2-v1" } };
      },
    },
  };
  const compiled = ts.transpileModule(source("../finance/phase2ShadowRecovery.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(compiled, { exports, require: (name: string) => dependencies[name] });
  return {
    calls,
    process: exports.processPhase2ShadowRecoveryJob as (client: unknown, job: Record<string, unknown>) => Promise<Record<string, unknown>>,
  };
}

const job = { id: "job-1", operation_key: "trip_commission:trip-1", trip_id: "trip-1", actor_id: "actor-1", status: "processing", attempts: 1 };

test("502, timeout and temporary RPC failures remain retryable", async () => {
  for (const posting of [
    { ok: false, code: "operation_failed", error: "Bad Gateway" },
    { ok: false, code: "contract_unavailable", error: "Temporary database availability failure" },
    new Error("timeout"),
  ]) {
    const h = recoveryHarness(posting);
    const result = await h.process({}, job);
    assert.equal(result.ok, false);
    assert.equal(result.retryable, true);
    assert.equal(h.calls.at(-1)?.name, "phase2_finish_shadow_recovery_job");
    assert.equal(h.calls.at(-1)?.args.p_retryable, true);
  }
});

test("deterministic contract and authorization failures become terminal", async () => {
  for (const code of ["operation_rejected", "contract_incompatible"]) {
    const h = recoveryHarness({ ok: false, code, error: "Deterministic failure" });
    const result = await h.process({}, job);
    assert.equal(result.ok, false);
    assert.equal(result.retryable, false);
    assert.equal(h.calls.at(-1)?.args.p_retryable, false);
  }
});

test("successful and already-posted recovery acknowledge one durable job", async () => {
  for (const replayed of [false, true]) {
    const h = recoveryHarness({ ok: true, result: { contract_version: "phase-2-v1", transaction_id: "tx-1", replayed } });
    const result = await h.process({}, job);
    assert.equal(result.ok, true);
    assert.equal(result.replayed, replayed);
    assert.deepEqual(h.calls.map((call) => call.name), ["phase2_post_trip_commission", "phase2_finish_shadow_recovery_job"]);
    assert.equal(h.calls.at(-1)?.args.p_succeeded, true);
  }
});
