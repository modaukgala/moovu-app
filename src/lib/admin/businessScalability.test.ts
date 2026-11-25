import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(compiled, { exports, URL, console, require: (name: string) => dependencies[name] });
  return exports;
}

const next = { NextResponse: { json: (body: unknown, options?: ResponseInit) =>
  Response.json(body, options) } };
type Row = Record<string, unknown>;
function database(tables: Record<string, Row[]>, error = false) {
  return { from(name: string) {
    let rows = (tables[name] ?? []).slice();
    const orders: string[] = [];
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { rows = rows.filter((r) => r[field] === value); return query; },
      in: (field: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[field])); return query; },
      not: (field: string, _op: string, values: string) => {
        rows = rows.filter((r) => !values.slice(1, -1).split(",").includes(String(r[field]))); return query;
      },
      or: (expression: string) => {
        const search = expression.match(/ilike\."%(.*?)%"/)?.[1]?.toLowerCase();
        rows = rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(search ?? "")));
        return query;
      },
      order: (field: string) => { orders.push(field); return query; },
      range: (start: number, end: number) => {
        rows.sort((a,b) => orders.reduce((comparison, field) => comparison || String(b[field]).localeCompare(String(a[field])), 0));
        return Promise.resolve(error ? { error: { message: "Unavailable" } } : { data: rows.slice(start, end+1), count: rows.length, error: null });
      },
    };
    return query;
  } };
}

const handler = (module: Record<string, unknown>, method: "GET" | "POST") => module[method] as (request: Request) => Promise<Response>;
const url = (query = "") => new Request(`http://local.invalid/${query}`);

test("driver directory filters before stable bounded pages and scopes application authority", async () => {
  const drivers = Array.from({ length: 111 }, (_, i) => ({ id: String(i).padStart(3,"0"),
    created_at: "same", first_name: i === 0 ? "Oldtown" : "Driver", online: i !== 1, status: "approved" }));
  let summaryIds: string[] = [];
  const route = (allowed = true, error = false) => handler(load("app/api/admin/drivers/list/route.ts", {
    "next/server": next,
    "@/lib/auth/admin": { requireAdminUser: async () => allowed
      ? { ok: true, profile: { role: "admin" }, supabaseAdmin: database({ drivers }, error) }
      : { ok: false, status: 401 }, isFinancialAdminRole: () => true },
    "@/lib/admin/applicationAuthority": { loadApplicationAuthority: async (_db: unknown, ids: string[]) => {
      summaryIds = Array.from(ids);
      return { current: new Map(), decisions: new Map() };
    } },
    "@/lib/admin/applicationSummary": { applicationSummary: () => null },
  }),"GET");
  const ids: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const response = await route()(url(`?online=true&status=approved&page=${page}`));
    const payload = await response.json();
    assert.equal(payload.pagination.total, 110);
    assert.deepEqual(summaryIds, payload.drivers.map((row: Row) => row.id));
    ids.push(...summaryIds);
    assert.ok(summaryIds.length <= 50);
  }
  assert.equal(new Set(ids).size, 110);
  assert.equal(ids.at(-1), "000");
  assert.equal((await (await route()(url("?q=Oldtown&online=true"))).json()).drivers[0].id, "000");
  assert.equal((await route(false)(url())).status, 401);
  assert.equal((await route(true,true)(url())).status, 500);
});

test("dispatch Board reaches the 1001st open trip independently of newer closed history", async () => {
  const trips = Array.from({ length: 1061 }, (_, i) => ({
    id: String(i).padStart(4,"0"), status: i < 1001 ? "requested" : "completed",
    pickup_address: i === 0 ? "Oldtown" : "Main Road", created_at: i >= 1001 ? "new" : "old",
  }));
  const route = (error = false) => handler(load("app/api/admin/dispatch/board/route.ts", {
    "next/server": next,
    "@/lib/auth/admin": { requireAdminUser: async () => ({ ok: true, supabaseAdmin: database({ trips }, error) }) },
  }),"GET");
  const result = await (await route()(url("?openPage=21"))).json();
  assert.equal(result.retrieval.openTripsTotal, 1001);
  assert.equal(result.retrieval.closedTripsTotal, 60);
  assert.equal(result.retrieval.openTripsVisible, 1);
  assert.ok(result.rows.some((row: Row) => row.id === "0000"));
  const filtered = await (await route()(url("?q=Oldtown&status=requested"))).json();
  assert.equal(filtered.retrieval.openTripsTotal, 1);
  assert.equal(filtered.retrieval.closedTripsTotal, 0);
  assert.equal((await route(true)(url())).status, 500);
});

test("strict new categories preserve supported IDs, missing defaults and historical normalization", async () => {
  const fare = await import(new URL("../domain/fare.ts", import.meta.url).href) as typeof import("../domain/fare");
  assert.equal(fare.newRideOptionId("go"), "go");
  assert.equal(fare.newRideOptionId("group"), "group");
  assert.equal(fare.newRideOptionId(undefined), "go");
  assert.equal(fare.newRideOptionId("unsupported"), null);
  assert.equal(fare.normalizeRideOptionId("historical"), "go");
  for (const path of ["app/api/admin/trips/create/route.ts", "app/api/admin/trips/auto-assign/route.ts"]) {
    const post = handler(load(path, { "next/server": next, "@/lib/domain/fare": fare,
      "@/lib/auth/admin": { requireAdminUser: async () => ({ ok: true }) } }),"POST");
    assert.equal((await post(new Request("http://local.invalid", { method: "POST",
      body: JSON.stringify({ rideOptionId: "unsupported" }) }))).status, 400);
  }
});

test("surge reader distinguishes configured, missing, invalid and failed reads, preserving effective fallbacks", async () => {
  const fare = await import(new URL("../domain/fare.ts", import.meta.url).href) as typeof import("../domain/fare");
  for (const [data, error, state] of [[{ value: { mode: "normal" } }, null, "configured"],
    [null,null,"absent"], [{ value: { mode: "bad" } }, null,"malformed"], [null,{ code: "42P01" },"failed"]] as const) {
    const lookup = { select: () => lookup, eq: () => lookup, maybeSingle: async () => ({ data,error }) };
    const result = load("lib/pricing/manualSurgeServer.ts", { "@/lib/domain/fare": fare,
      "@/lib/supabase/admin": { supabaseAdmin: { from: () => lookup } } });
    const read = result.readManualSurge as () => Promise<{ state: string; surge: { mode: string } }>;
    assert.equal((await read()).state, state);
    assert.equal((await read()).surge.mode, fare.DEFAULT_SURGE_MODE);
  }
});

test("dispatch baseline can hide a nearby driver beyond the candidate ceiling", async () => {
  const path = "lib/dispatch/dispatchCandidates.ts";
  const drivers = Array.from({ length: 251 }, (_, index) => ({ id: String(index), status: "approved",
    online: true, lat: index === 250 ? 0 : 10, lng: 0, seating_capacity: 5 }));
  let requestedLimit = 0;
  const query = { select: () => query, eq: () => query, gte: () => query,
    limit: async (limit: number) => { requestedLimit = limit; return { data: drivers.slice(0,limit), error: null }; } };
  const dispatch = load(path, {
    "@/lib/dispatch/config": { DISPATCH_CONFIG: { backgroundOfferEligibilitySeconds: 100 } },
    "@/lib/drivers/rideEligibility": { isDriverEligibleForRideOption: () => true },
    "@/lib/dispatch/driverScoring": { haversineKm: (_a: number,_b: number, lat: number) => lat },
  }).getDispatchCandidates as (input: unknown) => Promise<unknown[]>;
  const result = await dispatch({ supabase: { from: () => query }, tripId: "trip", pickupLat: 0, pickupLng: 0, radiusKm: 1 });
  assert.equal(requestedLimit, 250);
  assert.equal(drivers.at(-1)?.lat, 0);
  assert.equal(result.length, 0);
});

test("release gates preserve invalid/missing defaults and public configuration precedence", async () => {
  const flags = await import(new URL("../release/releaseFlags.ts", import.meta.url).href) as typeof import("../release/releaseFlags");
  assert.equal(flags.SCHEDULED_RIDES_ENABLED, false);
  for (const [value, expected] of [[undefined,false],["garbage",false],["disabled",false],[" ENABLED ",true]] as const) {
    const env = { NEXT_PUBLIC_MOOVU_PHASE6_NEW_WORK_ELIGIBILITY: value };
    assert.equal(flags.phase6EligibilityEnabled(env), expected);
  }
});

test("dispatch candidate path preserves freshness, vehicle, availability and radius checks", async () => {
  const eligibility = load("lib/drivers/rideEligibility.ts", {});
  const existing = { online: true, last_seen: new Date().toISOString(), status: "approved", seating_capacity: 7, lat: 1, lng: 0 };
  const fixtures = [
    { ...existing, id: "first" }, { ...existing, id: "second" },
    { ...existing, id: "outside", lat: 1.001 },
    { ...existing, id: "stale", last_seen: "1970-01-01T00:00:00.000Z" },
    { ...existing, id: "offline", online: false },
    { ...existing, id: "go-only", seating_capacity: 5 },
    { ...existing, id: "invalid-vehicle", seating_capacity: null },
    { ...existing, id: "busy", busy: true },
    { ...existing, id: "assigned" },
  ];
  const dispatch = load("lib/dispatch/dispatchCandidates.ts", {
    "@/lib/dispatch/config": { DISPATCH_CONFIG: { backgroundOfferEligibilitySeconds: 3600 } },
    "@/lib/drivers/rideEligibility": eligibility,
    "@/lib/dispatch/driverScoring": { haversineKm: (_a: number,_b: number, lat: number) => lat },
    "@/lib/finance/phase2DriverEligibility": { resolveDriverFinanceAuthority: async () => ({ ok: true, authority: { financiallyEligible: true } }) },
    "@/lib/drivers/phase6NewWork": { phase6NewWork: async () => ({ ok: true, eligible: true }) },
    "@/lib/dispatch/attemptHistory": { readOfferAttempts: async () => ({ data: [] }), untriedCandidatesFirst: (rows: unknown) => rows },
    "@/lib/trips/tripContract": { ACTIVE_ASSIGNED_TRIP_STATUSES: ["assigned"] },
    "@/lib/dispatch/offerContract": { ACTIVE_DRIVER_OFFER_STATUSES: ["pending"] },
  }).getDispatchCandidates as (input: unknown) => Promise<{ driverId: string; distanceKm: number; score: number }[]>;
  function client(failure = false) {
    return { from(table: string) {
      let rows: Row[] = table === "drivers" ? fixtures.slice() : table === "trips" ? [{ driver_id: "assigned" }] : [];
      const chain = {
        select: () => chain,
        eq: (field: string, value: unknown) => { rows = rows.filter((r) => r[field] === value); return chain; },
        gte: (field: string, value: string) => { rows = rows.filter((r) => String(r[field]) >= value); return chain; },
        limit: async (limit: number) => ({ data: rows.slice(0,limit), error: failure ? { message:"Unavailable" } : null }),
        in: () => chain, gt: () => chain, is: () => chain,
        then: (resolve: (result: unknown) => void) => resolve({ data: rows, error: null }),
      };
      return chain;
    } };
  }
  const input = { tripId: "trip", pickupLat: 0, pickupLng: 0, radiusKm: 1, rideOption: "group", cycle: 1 };
  const result = await dispatch({ ...input, supabase: client() });
  assert.deepEqual(Array.from(result, (row) => row.driverId), ["first", "second"]);
  assert.equal(result[0].distanceKm, 1);
  assert.equal(result[0].score, result[1].score);
  await assert.rejects(dispatch({ ...input, supabase: client(true) }), /Unavailable/);
});

test("authenticated Driver profile publishes only the effective Phase 6 boolean", async () => {
  const flags = await import(new URL("../release/releaseFlags.ts", import.meta.url).href) as typeof import("../release/releaseFlags");
  const publicKey = "NEXT_PUBLIC_MOOVU_PHASE6_NEW_WORK_ELIGIBILITY";
  const privateKey = "MOOVU_PHASE6_NEW_WORK_ELIGIBILITY";
  const cases = [
    [{ [publicKey]: "enabled" }, true],
    [{ [publicKey]: "disabled", [privateKey]: "enabled" }, false],
    [{ [publicKey]: "invalid", [privateKey]: "enabled" }, false],
    [{}, false],
    [{ [privateKey]: "enabled" }, true],
    [{ [privateKey]: "disabled" }, false],
    [{ [publicKey]: "enabled", [privateKey]: "disabled" }, true],
    [{ [publicKey]: "", [privateKey]: "enabled" }, false],
  ] as const;
  const driver = { id: "synthetic-driver", subscription_status: "active" };
  const endpoint = (resolve: () => boolean) => handler(load("app/api/driver/me/route.ts", {
    "next/server": next,
    "@/lib/release/releaseFlags": { phase6EligibilityEnabled: resolve },
    "@/lib/supabase/admin": { supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: "driver-user" } } }) },
      rpc: async () => ({}),
      from: (table: string) => {
        const query = {
          select: () => query, eq: () => query,
          maybeSingle: async () => ({ data: table === "driver_accounts" ? { driver_id: driver.id } : driver }),
        };
        return query;
      },
    } },
  }), "GET");
  const request = new Request("http://local.invalid", { headers: { authorization: "Bearer synthetic" } });
  for (const [environment, expected] of cases) {
    const res = await endpoint(() => flags.phase6EligibilityEnabled(environment))(request);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await res.json(), { ok: true, driver, phase6NewWorkEnabled: expected });
  }
  const unavailable = await endpoint(() => { throw new Error("synthetic configuration unavailable"); })(request);
  assert.equal(unavailable.status, 500);
  assert.equal(Object.hasOwn(await unavailable.json(), "phase6NewWorkEnabled"), false);
  assert.equal((await endpoint(() => assert.fail("resolution before authentication"))(url())).status, 401);
});
