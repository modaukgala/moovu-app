import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("Approved payment replay must allow recovery of failed shadow posting", async () => {
  const route = await read("src/app/api/admin/payment-reviews/route.ts");
  assert.doesNotMatch(route,
    /if\s*\(\s*!result\.replayed\s*&&\s*result\.status\s*===\s*"approved"\s*&&\s*financeMode\s*===\s*"SHADOW"\s*\)/,
    "Legacy approval replay must not suppress the idempotent shadow retry after a failed posting");
});

test("Payment RPC rejects missing identity and role before financial work", async () => {
  const sql = await read("docs/phase-2-commission-driver-finance-migration.sql");
  const payment = sql.split("create or replace function public.phase2_post_verified_driver_payment(")[1].split("end $$;")[0];
  assert.match(payment, /if p_actor_id is null then raise exception/);
  assert.match(payment, /if v_role is null or v_role not in \('owner','admin'\) then\s+raise exception/);
  assert.match(payment, /auth\.role\(\) is distinct from 'service_role'/);
  const guard = payment.indexOf("if v_role is null");
  for (const operation of ["select * into strict v_request", "pg_advisory_xact_lock", "phase1_ensure_financial_account", "phase1_post_financial_transaction"]) {
    assert.ok(guard >= 0 && guard < payment.indexOf(operation), operation);
  }
  const route = await read("src/app/api/admin/payment-reviews/route.ts");
  assert.match(route, /"phase2_post_verified_driver_payment",\s*\{\s*p_request_id: requestId,\s*p_actor_id: auth\.user\.id/);
});

test("Phase 2 migration defaults OFF and preserves historical trips", async () => {
  const sql = await read("docs/phase-2-commission-driver-finance-migration.sql");
  assert.match(sql, /'phase2-driver-finance','OFF',1500,1500,5000,4000,true,null/);
  assert.doesNotMatch(sql, /update\s+public\.trips\s+set\s+commission_basis_points\s*=\s*1500/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.(trips|financial_)/i);
});

test("Phase 2 financial surfaces remain server-only", async () => {
  const sql = await read("docs/phase-2-commission-driver-finance-migration.sql");
  assert.match(sql, /revoke all on public\.phase2_finance_policy[\s\S]*from public,anon,authenticated/i);
  assert.match(sql, /revoke all on function public\.phase2_post_trip_commission\(uuid,uuid\) from public,anon,authenticated/i);
  assert.match(sql, /grant execute on function public\.phase2_post_trip_commission\(uuid,uuid\) to service_role/i);
});

test("Phase 2 reuses compatible Phase 1 account identities through the protected validator", async () => {
  const sql = await read("docs/phase-2-commission-driver-finance-migration.sql");
  const posting = sql.split("create or replace function public.phase2_post_trip_commission(")[1];
  assert.equal([...posting.matchAll(/phase1_ensure_financial_account\(\s*coalesce\(\(select account_code/g)].length, 5);
  assert.doesNotMatch(posting, /insert into public\.financial_accounts/i);
});

test("Phase 2 hashing works with the locked function search path", async () => {
  const sql = await read("docs/phase-2-commission-driver-finance-migration.sql");
  assert.equal([...sql.matchAll(/pg_catalog\.sha256\(convert_to\(v_payload::text,'UTF8'\)\)/g)].length, 2);
  assert.doesNotMatch(sql, /\bdigest\(/);
});

test("SHADOW and AUTHORITATIVE completion share durable recovery while payment selects mode authority", async () => {
  const completion = await read("src/lib/trips/completeTripServer.ts");
  const payment = await read("src/app/api/admin/payment-reviews/route.ts");
  assert.doesNotMatch(completion, /authoritative completion is not activated/i);
  assert.match(completion, /financeMode !== "OFF"/);
  assert.match(completion, /requires reconciliation/);
  assert.doesNotMatch(payment, /authoritative payment review is not activated/i);
  assert.match(payment, /financeMode === "AUTHORITATIVE" \? "phase2_review_driver_payment" : "phase05b_review_driver_payment"/);
  const migration = await read("docs/phase-2-authoritative-cutover.sql");
  assert.match(migration, /authoritative_effective_from timestamptz/);
  assert.match(migration, /AUTHORITATIVE cutoff is immutable/);
  assert.match(migration, /if not v_authoritative then[\s\S]*insert into public\.driver_wallet_transactions/);
  assert.match(migration, /v_pct:=case when v_authoritative then/);
});

test("Every Phase 2 function explicitly revokes default client execution", async () => {
  const sql = (await read("docs/phase-2-commission-driver-finance-migration.sql"))
    .replace(/--[^\n]*/g, "");
  const definitions = [...sql.matchAll(/create or replace function public\.(phase2_\w+)\(([^)]*)\)/gi)];
  assert.ok(definitions.length >= 9);
  for (const [, name, parameters] of definitions) {
    const types = parameters.trim()
      ? parameters.split(",").map((parameter) => parameter.trim().split(/\s+/)[1]).join(",")
      : "";
    const signature = `public.${name}(${types})`;
    const statements = sql.split(";").map((statement) => statement.trim().toLowerCase().replace(/\s+/g, " "));
    for (const role of ["public", "anon", "authenticated"]) {
      assert.ok(statements.some((statement) => {
        const match = statement.match(/^revoke (?:all|execute) on function (.+) from (.+)$/);
        return match?.[1] === signature && match[2].split(",").map((value) => value.trim()).includes(role);
      }), `${signature} must revoke ${role} execution`);
    }
  }
  assert.doesNotMatch(sql, /grant\s+(?:all|execute)\s+on\s+function\s+public\.phase2_[^;]*\bto\s+(?:public|anon|authenticated)\b/i);
});
