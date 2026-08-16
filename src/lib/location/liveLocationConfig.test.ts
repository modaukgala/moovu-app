import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { DISPATCH_CONFIG } from "../dispatch/config.ts";

const LOCATION_PUBLISH_MS = 30_000;
const configSource = readFileSync(new URL("./liveLocationConfig.ts", import.meta.url), "utf8");

function numericConfigValue(name: string) {
  const match = configSource.match(new RegExp(`${name}:\\s*(\\d+)`));
  assert.ok(match, `Expected ${name} in live location configuration`);
  return Number(match[1]);
}

test("network location publication uses a thirty-second cadence", () => {
  assert.equal(numericConfigValue("driverActiveHeartbeatMs"), LOCATION_PUBLISH_MS);
  assert.equal(numericConfigValue("driverMovingHeartbeatMs"), LOCATION_PUBLISH_MS);
  assert.equal(numericConfigValue("idleHeartbeatMs"), LOCATION_PUBLISH_MS);
  assert.equal(numericConfigValue("customerTripLocationFallbackMs"), LOCATION_PUBLISH_MS);
  assert.equal(numericConfigValue("customerTripLocationHiddenFallbackMs"), LOCATION_PUBLISH_MS);
  assert.equal(numericConfigValue("adminDispatchMapRefreshMs"), LOCATION_PUBLISH_MS);
});

test("local GPS stays responsive without increasing backend writes", () => {
  assert.ok(numericConfigValue("driverSampleMs") < LOCATION_PUBLISH_MS);
});

test("offer and trip polling remain independent from location publication", () => {
  assert.equal(numericConfigValue("driverOfferPollMs"), 10_000);
  assert.equal(numericConfigValue("driverTripPollMs"), 10_000);
  assert.equal(numericConfigValue("driverHiddenPollMs"), 15_000);
});

test("freshness windows tolerate the thirty-second publish interval", () => {
  assert.ok(numericConfigValue("customerDriverStaleSeconds") >= 90);
  assert.ok(DISPATCH_CONFIG.gpsFreshnessSeconds * 1000 >= LOCATION_PUBLISH_MS * 3);
});
