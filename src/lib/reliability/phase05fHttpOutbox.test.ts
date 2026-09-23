import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const routeContracts = [
  ["../../app/api/driver/apply/route.ts", "phase05b_submit_driver_application"],
  ["../../app/api/admin/payment-reviews/route.ts", "phase05b_review_driver_payment"],
  ["../../app/api/admin/settlements/record/route.ts", "phase05b_record_settlement"],
  ["../../app/api/driver/trips/arrive/route.ts", "phase05b_mark_arrived"],
  ["../trips/completeTripServer.ts", "phase05b_complete_trip"],
  ["../../app/api/customer/cancel-trip/route.ts", "phase05b_cancel_trip"],
  ["../../app/api/driver/trips/no-show/route.ts", "phase05b_mark_no_show"],
] as const;

test("sensitive HTTP paths use one authoritative hardened RPC boundary", () => {
  for (const [path, rpc] of routeContracts) {
    const code = source(path);
    assert.match(code, /callHardenedRpc/);
    assert.match(code, new RegExp(`['\"]${rpc}['\"]`));
    assert.doesNotMatch(code, /if\s*\([^)]*(?:contract_unavailable|contract_incompatible)[^)]*\)[\s\S]{0,300}\.from\(/);
  }
});

test("hardened route notifications defer to outbox only under explicit activation", () => {
  for (const [path] of routeContracts.filter(([path]) => !path.includes("settlements"))) {
    const code = source(path);
    assert.match(code, /isOutboxDeliveryEnabled/);
  }
});

test("financial HTTP mutations reject dispatcher and support before RPC invocation", () => {
  const financialRoutes = [
    "../../app/api/admin/payment-reviews/route.ts",
    "../../app/api/admin/settlements/record/route.ts",
    "../../app/api/admin/driver-subscription-payments/route.ts",
    "../../app/api/admin/driver-subscription-activate/route.ts",
    "../../app/api/admin/subscriptions/update/route.ts",
  ];
  for (const path of financialRoutes) {
    const code = source(path);
    assert.match(code, /isFinancialAdminRole\(auth\.profile\.role\)/);
    assert.match(code, /status:\s*403/);
    assert.ok(code.indexOf("isFinancialAdminRole") < code.indexOf("callHardenedRpc<"));
  }
});

test("legacy trip-status mutation remains disabled", () => {
  const code = source("../../app/api/driver/trip-status/route.ts");
  assert.match(code, /status:\s*410/);
  assert.doesNotMatch(code, /supabase|\.from\(|\.rpc\(/);
});

test("outbox SQL recovers stale claims, bounds retries, and enforces notification identity", () => {
  const foundation = source("../../../docs/phase-05b-001-financial-foundation.sql");
  const tripAtomicity = source("../../../docs/phase-05b-002-trip-atomicity.sql");
  const assignment = source("../../../docs/phase-05b-003-applicant-assignment-outbox.sql");
  assert.match(foundation, /add column if not exists event_key text/i);
  assert.match(foundation, /unique index if not exists app_notifications_user_event_key_uidx[\s\S]*user_id,event_key/i);
  assert.match(assignment, /status='processing'[\s\S]*locked_at<=now\(\)-interval '5 minutes'/i);
  assert.match(assignment, /attempts<8/i);
  assert.match(assignment, /for update skip locked/i);
  assert.match(tripAtomicity, /'trip-arrived:'\|\|t\.id::text,'trip_arrived'/i);
  assert.match(tripAtomicity, /values\(v_event,'trip_arrived'/i);
});

test("outbox worker is secret protected, activation gated, and acknowledges through RPC", () => {
  const code = source("../../app/api/jobs/outbox/route.ts");
  assert.match(code, /isOutboxWorkerAuthorized/);
  assert.match(code, /isOutboxDeliveryEnabled/);
  assert.match(code, /phase05b_claim_outbox/);
  assert.match(code, /phase05b_finish_outbox/);
  assert.match(code, /notificationEventKey:\s*eventKey/);
});

test("push history uses per-user event-key upsert instead of duplicate inserts", () => {
  const code = source("../push-server.ts");
  assert.match(code, /notificationEventKey\?: string/);
  assert.match(code, /upsert\(rows, \{ onConflict: "user_id,event_key" \}\)/);
});
