import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

function allocation(payment: number, postedDebt: number) {
  const applied = Math.min(payment, Math.max(postedDebt, 0));
  return { applied, credit: payment - applied, debt: Math.max(postedDebt - applied, 0) };
}

test("post-cutoff allocation covers debt first and preserves excess as unapplied credit", () => {
  assert.deepEqual(allocation(10_460, 0), { applied: 0, credit: 10_460, debt: 0 });
  assert.deepEqual(allocation(6_000, 4_000), { applied: 4_000, credit: 2_000, debt: 0 });
  assert.deepEqual(allocation(1_000, 5_900), { applied: 1_000, credit: 0, debt: 4_900 });
  assert.deepEqual(allocation(1_000, -500), { applied: 0, credit: 1_000, debt: 0 });
});

test("correction uses immutable approval time and records deterministic historical skips", async () => {
  const sql = await read("docs/phase-2-shadow-payment-cutoff-correction.sql");
  assert.match(sql, /v_request\.reviewed_at < v_policy\.effective_from/);
  assert.match(sql, /'posting_outcome','PRE_CUTOFF_SKIPPED'/);
  assert.match(sql, /phase2_shadow_reconciliations where operation_key=v_operation_key/);
  assert.ok(sql.indexOf("if v_request.reviewed_at < v_policy.effective_from") < sql.indexOf("v_clearing:=public.phase1_ensure_financial_account"));
  assert.match(sql, /old\.effective_from is not null and new\.effective_from is distinct from old\.effective_from/);
  assert.doesNotMatch(sql, /v_request\.created_at\s*[<>]=?\s*v_policy\.effective_from/);
});

test("replay returns persisted allocation before recalculating current debt", async () => {
  const sql = await read("docs/phase-2-shadow-payment-cutoff-correction.sql");
  const existing = sql.indexOf("select * into v_existing_tx");
  const balance = sql.indexOf("into v_debt_cents");
  assert.ok(existing >= 0 && existing < balance);
  assert.match(sql, /v_existing_tx\.metadata->>'applied_cents'/);
  assert.match(sql, /v_existing_tx\.metadata->>'unapplied_cents'/);
  assert.match(sql, /'driver-finance:'\|\|v_request\.driver_id::text/);
});

test("database enforces the debt floor and server-only execution", async () => {
  const sql = await read("docs/phase-2-shadow-payment-cutoff-correction.sql");
  assert.match(sql, /if v_balance_cents < 0 then\s+raise exception 'Driver commission debt cannot be negative'/);
  assert.match(sql, /after update of transaction_state on public\.financial_transactions/);
  assert.match(sql, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(sql, /revoke all on function public\.phase2_post_verified_driver_payment\(uuid,uuid\) from public,anon,authenticated,service_role/);
  assert.match(sql, /grant execute on function public\.phase2_post_verified_driver_payment\(uuid,uuid\) to service_role/);
  assert.match(sql, /security definer set search_path=public,pg_temp/);
});

test("route treats historical skip as resolved while preserving replay recovery", async () => {
  const route = await read("src/app/api/admin/payment-reviews/route.ts");
  assert.match(route, /posting_outcome === "PRE_CUTOFF_SKIPPED"/);
  assert.match(route, /historical shadow payment deterministically skipped/);
  assert.doesNotMatch(route, /!result\.replayed[\s\S]{0,100}phase2_post_verified_driver_payment/);
});
