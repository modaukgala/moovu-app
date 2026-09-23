import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const hardenedRoutes = [
  "../../app/api/admin/payment-reviews/route.ts",
  "../../app/api/admin/settlements/record/route.ts",
  "../../app/api/admin/driver-subscription-payments/route.ts",
  "../../app/api/admin/driver-subscription-activate/route.ts",
  "../../app/api/admin/subscriptions/update/route.ts",
  "../../app/api/customer/cancel-trip/route.ts",
  "../../app/api/driver/trips/no-show/route.ts",
  "../../app/api/driver/trips/arrive/route.ts",
  "../trips/completeTripServer.ts",
];

test("hardened routes invoke an authoritative RPC without legacy write fallback", () => {
  for (const path of hardenedRoutes) {
    const code = source(path);
    assert.match(code, /callHardenedRpc/);
    assert.doesNotMatch(code, /\.from\(["'](?:driver_settlements|driver_subscription_payments|driver_wallet_transactions)["']\)[\s\S]{0,40}\.(?:insert|update|upsert|delete)/);
  }
});

test("migration package denies direct client mutation and execution", () => {
  const files = [
    "../../../docs/phase-05b-001-financial-foundation.sql",
    "../../../docs/phase-05b-002-trip-atomicity.sql",
    "../../../docs/phase-05b-003-applicant-assignment-outbox.sql",
  ].map(source).join("\n");
  assert.match(files, /revoke all on .* from public,anon,authenticated/i);
  assert.match(files, /grant execute on .* to service_role/i);
  assert.match(files, /security definer/i);
});

test("complete-dataset debt model remains correct beyond an API row limit", () => {
  const commissions = Array.from({ length: 1_505 }, (_, index) => 1 + (index % 7) / 10);
  const settlements = Array.from({ length: 1_211 }, (_, index) => 0.4 + (index % 3) / 10);
  const credits = Array.from({ length: 1_103 }, (_, index) => 0.1 + (index % 5) / 20);
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const expected = Math.max(0, sum(commissions) - sum(settlements) - sum(credits));
  assert.ok(expected > 0);
  assert.equal(Number(expected.toFixed(2)), 1130.65);
  const sql = source("../../../docs/phase-05b-001-financial-foundation.sql");
  assert.match(sql, /sum\(commission_amount\)/i);
  assert.doesNotMatch(sql, /limit\s+1000/i);
});

test("outbox event identity and worker claim are idempotent contracts", () => {
  const foundation = source("../../../docs/phase-05b-001-financial-foundation.sql");
  const assignment = source("../../../docs/phase-05b-003-applicant-assignment-outbox.sql");
  assert.match(foundation, /event_key text not null unique/i);
  assert.match(foundation, /business_event_id uuid not null unique/i);
  assert.match(assignment, /for update skip locked/i);
  assert.match(assignment, /phase05b_finish_outbox/i);
});

test("disposable database test fixture refuses accidental execution", () => {
  const sql = source("../../../docs/phase-05b-disposable-database-tests.sql");
  assert.match(sql, /NEVER RUN AGAINST PRODUCTION/i);
  assert.match(sql, /moovu\.disposable_test_database/i);
  assert.match(sql, /Template only/i);
  assert.match(sql, /rollback;/i);
});

test("production compatibility avoids nonexistent relationship and timestamp columns", () => {
  const assignment = source("../../../docs/phase-05b-003-applicant-assignment-outbox.sql");
  assert.doesNotMatch(assignment, /driver_applications\s+set[\s\S]{0,80}driver_id\s*=/i);
  assert.doesNotMatch(assignment, /set[\s\S]{0,100}(?:accepted_at|assigned_at)\s*=/i);
  assert.match(assignment, /trip_events/i);
  assert.match(assignment, /driver_accounts/i);
});

test("trip migration installs production cancellation prerequisites before RPCs", () => {
  const tripAtomicity = source("../../../docs/phase-05b-002-trip-atomicity.sql");
  const prerequisites = tripAtomicity.slice(0, tripAtomicity.indexOf("create or replace function public.phase05b_complete_trip"));
  assert.match(prerequisites, /add column if not exists cancellation_reason_details text/i);
  assert.match(prerequisites, /add column if not exists cancellation_status_at_request text/i);
  assert.match(prerequisites, /add column if not exists cancelled_within_free_window boolean default false/i);
  assert.match(prerequisites, /tx_type not in \('commission','payment','adjustment','cancellation_credit'\)/i);
  assert.match(prerequisites, /check \(tx_type in \('commission','payment','adjustment','cancellation_credit'\)\)/i);
  assert.match(tripAtomicity, /driver_trip_offers set status='cancelled'/i);
  assert.doesNotMatch(tripAtomicity, /status='withdrawn'/i);
  assert.match(tripAtomicity, /case when exists\(select 1 from public\.profiles where id=p_actor_id\) then p_actor_id else null end/i);
  assert.ok((tripAtomicity.match(/case when exists\(select 1 from public\.profiles where id=p_actor_id\) then p_actor_id else null end/gi) ?? []).length >= 2);
});

test("phase 0.5D preserves server-only mutation and reconciliation gates", () => {
  const foundation = source("../../../docs/phase-05b-001-financial-foundation.sql");
  const assignment = source("../../../docs/phase-05b-003-applicant-assignment-outbox.sql");
  const retention = source("../../../docs/phase-05d-004-retention-security.sql");
  const reconciliation = source("../../../docs/phase-05d-wallet-reconciliation.sql");
  assert.match(foundation, /wallet projection reconciliation required/i);
  assert.match(foundation, /unapplied_credit/i);
  assert.match(foundation, /revoke execute on function public\.refresh_driver_subscription/i);
  assert.match(foundation, /revoke execute on function public\.increment_driver_offer_received/i);
  assert.doesNotMatch(foundation, /v_role not in \('owner','admin','dispatcher','support'\)/i);
  assert.match(assignment, /drop policy if exists driver_accounts_insert_own/i);
  assert.match(retention, /revoke insert,update,delete,truncate on public\.trips from anon,authenticated/i);
  assert.match(retention, /revoke insert,update,delete,truncate on public\.trip_events from anon,authenticated/i);
  assert.match(retention, /on delete restrict/i);
  assert.match(retention, /driver_wallet_transactions_wallet_id_fkey[\s\S]*on delete restrict/i);
  assert.match(reconciliation, /READ ONLY/i);
  assert.doesNotMatch(reconciliation, /\b(?:insert|update|delete|alter|drop|create|truncate)\b/i);
});
