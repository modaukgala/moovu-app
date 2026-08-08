import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { DISPATCH_CONFIG, dispatchRadiusForCycle, isDispatchExpired } from "./config.ts";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { scoreDriverForTrip } from "./driverScoring.ts";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { dispatchJobsQueued } from "./dispatchScheduler.ts";

test("dispatch timing uses three automatic rounds and a thirty-minute admin recovery window", () => {
  assert.equal(DISPATCH_CONFIG.escalationSeconds, 25);
  assert.equal(DISPATCH_CONFIG.acceptWindowSeconds, 25);
  assert.equal(DISPATCH_CONFIG.maxSearchSeconds, 30 * 60);
  assert.equal(DISPATCH_CONFIG.maxCycles, 3);
});

test("dispatch expiry is measured from the original request time", () => {
  const now = Date.parse("2026-07-24T10:30:00.000Z");
  assert.equal(isDispatchExpired("2026-07-24T10:00:00.000Z", now), true);
  assert.equal(isDispatchExpired("2026-07-24T10:00:01.000Z", now), false);
});

test("an online driver remains offer-eligible while the native app is backgrounded", () => {
  assert.ok(DISPATCH_CONFIG.backgroundOfferEligibilitySeconds >= 8 * 60 * 60);
  assert.ok(DISPATCH_CONFIG.backgroundOfferEligibilitySeconds > DISPATCH_CONFIG.gpsFreshnessSeconds);
});

test("dispatch radius expands by cycle and remains capped", () => {
  assert.equal(dispatchRadiusForCycle(1), DISPATCH_CONFIG.initialRadiusKm);
  assert.ok(dispatchRadiusForCycle(2) > dispatchRadiusForCycle(1));
  assert.equal(dispatchRadiusForCycle(99), DISPATCH_CONFIG.expandedRadiusKm);
});

test("an ineligible or busy driver cannot receive a valid score", () => {
  const score = scoreDriverForTrip({
    pickupLat: -25.1,
    pickupLng: 29.1,
    driver: { id: "driver", lat: -25.1, lng: 29.1, online: true, busy: true },
  });
  assert.equal(score.score, -9999);
});

test("new drivers receive neutral rather than perfect quality defaults", () => {
  const neutral = scoreDriverForTrip({
    pickupLat: -25.1,
    pickupLng: 29.1,
    driver: { id: "new", lat: -25.1, lng: 29.1, online: true, busy: false, subscription_status: "active" },
  });
  const perfect = scoreDriverForTrip({
    pickupLat: -25.1,
    pickupLng: 29.1,
    driver: {
      id: "established",
      lat: -25.1,
      lng: 29.1,
      online: true,
      busy: false,
      subscription_status: "active",
      quality: { avg_rating: 5, quality_score: 100, acceptance_rate: 100 },
    },
  });
  assert.ok(neutral.score < perfect.score);
});

test("dispatch reports incomplete scheduler enqueue results", () => {
  assert.equal(dispatchJobsQueued([{ ok: true }, { ok: true }]), true);
  assert.equal(dispatchJobsQueued([{ ok: true }, { ok: false, error: "queue unavailable" }]), false);
});

