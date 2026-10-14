import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cutover = readFileSync(new URL("../../../docs/phase-2-authoritative-cutover.sql", import.meta.url), "utf8");
const ledger = readFileSync(new URL("../../../docs/phase-2-commission-driver-finance-migration.sql", import.meta.url), "utf8");

test("authoritative completion does not also charge the legacy wallet", () => {
  const completion = cutover.split("create or replace function public.phase05b_complete_trip(")[1];
  assert.ok(completion, "cutover must define the installed completion signature");
  assert.match(completion, /v_authoritative:=v_policy\.mode='AUTHORITATIVE'[\s\S]*?t\.created_at>=v_policy\.authoritative_effective_from/);
  assert.match(completion, /if not v_authoritative then\s+insert into public\.driver_wallets[\s\S]*?insert into public\.driver_wallet_transactions[\s\S]*?end if;/);
  assert.match(completion, /if not v_authoritative then perform public\.phase05b_refresh_driver_wallet\(t\.driver_id\); end if;/);
  assert.match(completion, /perform public\.phase2_enqueue_shadow_trip_recovery\(t\.id,p_actor_id,v_event\);/);
});

test("Phase 2 posts from the locked snapshot with one idempotency key", () => {
  const posting = ledger.split("create or replace function public.phase2_post_trip_commission(")[1]
    ?.split("create or replace function public.phase2_post_verified_driver_payment(")[0];
  assert.ok(posting, "Phase 2 posting function must exist");
  assert.match(posting, /v_trip\.commission_locked_at is null[\s\S]*?v_trip\.commission_basis_points is null/);
  assert.match(posting, /v_commission_cents:=\(v_fare_cents\*v_trip\.commission_basis_points\+5000\)\/10000/);
  assert.match(posting, /phase1_post_financial_transaction\('trip_commission:'\|\|v_trip\.id::text/);

  const installedFareBasis = readFileSync(new URL("../../../docs/phase-5-atomic-operations.sql", import.meta.url), "utf8");
  assert.match(installedFareBasis, /v_trip\.phase5_driver_fare_basis_cents/);
});
