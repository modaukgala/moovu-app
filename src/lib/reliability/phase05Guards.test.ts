import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// Source-contract checks only: these do not execute routes or prove DB behaviour.
test("admin booking derives fare metrics from the controlled server route", () => {
  const code = source("../../app/api/admin/trips/create/route.ts");
  assert.match(code, /from "@\/lib\/maps\/routeService"/);
  assert.match(code, /const \{ distanceKm, durationMin \} = route/);
  assert.doesNotMatch(code, /Number\(body\??\.distanceKm\)/);
  assert.ok(code.indexOf("if (!route") < code.indexOf("const calculatedFare"));
  assert.ok(code.indexOf("status: 503") < code.indexOf('.from("trips")'));
});

test("arrival uses the hardened database contract with no direct status write", () => {
  const code = source("../../app/api/driver/trips/arrive/route.ts");
  assert.match(code, /callHardenedRpc<\{/);
  assert.match(code, /"phase05b_mark_arrived"/);
  assert.match(code, /p_driver_id: driverId/);
  assert.doesNotMatch(code, /\.from\("trips"\)[\s\S]{0,40}\.update\(/);
});

test("admin removal does not explicitly delete wallet history", () => {
  const code = source("../../app/api/admin/drivers/remove/route.ts");
  assert.doesNotMatch(code, /\.from\("driver_wallet(?:s|_transactions)"\)\s*\.delete\(/);
});
