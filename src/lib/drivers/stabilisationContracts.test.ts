import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error Node strip-types requires explicit extensions.
import { phase6NewWork } from "./phase6NewWork.ts";
// @ts-expect-error Node strip-types requires explicit extensions.
import { phase6DriverNoticeEnabled, phase6EligibilityEnabled, SCHEDULED_RIDES_ENABLED } from "../release/releaseFlags.ts";
// @ts-expect-error Node strip-types requires explicit extensions.
import { canTransitionTrip, isTripStatus, TRIP_STATUSES } from "../trips/tripContract.ts";
// @ts-expect-error Node strip-types requires explicit extensions.
import { ACTIVE_DRIVER_OFFER_STATUSES, DRIVER_OFFER_STATUSES } from "../dispatch/offerContract.ts";

test("Phase 6 eligibility is explicitly dormant by default", async () => {
  const previous = process.env.MOOVU_PHASE6_NEW_WORK_ELIGIBILITY;
  delete process.env.MOOVU_PHASE6_NEW_WORK_ELIGIBILITY;
  let calls = 0;
  const client = { rpc: async () => { calls += 1; return { data: null, error: new Error("missing") }; } };
  const result = await phase6NewWork(client as never, "00000000-0000-4000-8000-000000000001");
  assert.equal(phase6EligibilityEnabled(), false);
  assert.deepEqual(result, { ok: true, eligible: true, authority: "legacy_production", error: null });
  assert.equal(calls, 0);
  if (previous == null) delete process.env.MOOVU_PHASE6_NEW_WORK_ELIGIBILITY; else process.env.MOOVU_PHASE6_NEW_WORK_ELIGIBILITY = previous;
});

test("one public Phase 6 switch controls both enforcement and the Driver notice", () => {
  const environment = {
    NODE_ENV: "test",
    NEXT_PUBLIC_MOOVU_PHASE6_NEW_WORK_ELIGIBILITY: "enabled",
  } as NodeJS.ProcessEnv;
  assert.equal(phase6EligibilityEnabled(environment), true);
  assert.equal(phase6DriverNoticeEnabled(environment), true);
  const disabledEnvironment = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
  assert.equal(phase6EligibilityEnabled(disabledEnvironment), false);
  assert.equal(phase6DriverNoticeEnabled(disabledEnvironment), false);
});

test("Driver home hides the Phase 6 notice through the centralized switch", () => {
  const page = readFileSync("src/app/driver/page.tsx", "utf8");
  assert.match(page, /phase6DriverNoticeEnabled\(\)/);
});

test("enabled Phase 6 eligibility fails closed when its RPC is absent", async () => {
  const previous = process.env.MOOVU_PHASE6_NEW_WORK_ELIGIBILITY;
  process.env.MOOVU_PHASE6_NEW_WORK_ELIGIBILITY = "enabled";
  const client = { rpc: async () => ({ data: null, error: { code: "PGRST202" } }) };
  const result = await phase6NewWork(client as never, "00000000-0000-4000-8000-000000000001");
  assert.equal(result.ok, false);
  assert.equal(result.eligible, false);
  if (previous == null) delete process.env.MOOVU_PHASE6_NEW_WORK_ELIGIBILITY; else process.env.MOOVU_PHASE6_NEW_WORK_ELIGIBILITY = previous;
});

test("current trip and offer contracts contain only production-compatible states", () => {
  assert.deepEqual(TRIP_STATUSES, ["requested","offered","assigned","arrived","ongoing","completed","cancelled"]);
  assert.equal(isTripStatus("scheduled"), false);
  assert.equal(canTransitionTrip("offered", "assigned"), true);
  assert.equal(canTransitionTrip("completed", "ongoing"), false);
  assert.deepEqual(DRIVER_OFFER_STATUSES, ["pending","shown","accepted","declined","expired","cancelled"]);
  assert.deepEqual(ACTIVE_DRIVER_OFFER_STATUSES, ["pending","shown"]);
});

test("scheduled creation is gated at UI and API authority", () => {
  assert.equal(SCHEDULED_RIDES_ENABLED, false);
  const route = readFileSync("src/app/api/customer/book-trip/route.ts", "utf8");
  const page = readFileSync("src/app/book/page.tsx", "utf8");
  assert.match(route, /SCHEDULED_RIDES_DISABLED/);
  assert.match(page, /disabled=\{!SCHEDULED_RIDES_ENABLED\}/);
});

test("atomic assignment and completion contracts remain server-side and idempotent", () => {
  const dispatch = readFileSync("docs/atomic-dispatch-migration.sql", "utf8");
  const completion = readFileSync("src/lib/trips/completeTripServer.ts", "utf8");
  assert.match(dispatch, /accept_trip_offer/);
  assert.match(dispatch, /for update/i);
  assert.match(dispatch, /OFFER_CONFLICT|DRIVER_CONFLICT/);
  assert.match(completion, /phase05b_complete_trip/);
  assert.match(completion, /replayed/);
  assert.match(completion, /trip_commission:\$\{tripId\}/);
});

test("release preflight is read-only and manifest names the required baseline", () => {
  const script = readFileSync("scripts/release-schema-preflight.mjs", "utf8");
  const manifest = JSON.parse(readFileSync("docs/moovu-release-baseline-manifest.json", "utf8"));
  assert.match(script, /method|fetch/);
  assert.doesNotMatch(script, /method:\s*["'](?:POST|PATCH|DELETE)/);
  assert.equal(manifest.applicationContract.schemaProfile, "baseline");
  assert.equal(manifest.production.phase6EligibilityInstalled, false);
});
