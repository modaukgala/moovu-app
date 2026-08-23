import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { addIncrementalStopCharge, buildLockedFareBreakdown, resolveLockedTripFare } from "./lockedTripFare.ts";

test("confirmed booking fares remain unchanged", () => {
  for (const fare of [40, 76, 120, 250, 95]) {
    assert.equal(resolveLockedTripFare({ finalFare: fare, fareAmount: fare }), fare);
  }
});

test("live telemetry is not an input to the locked fare", () => {
  assert.equal(resolveLockedTripFare({ finalFare: 76, fareAmount: 76 }), 76);
  assert.equal(buildLockedFareBreakdown({ finalFare: 120 })?.finalFare, 120);
});

test("legacy trips use the safest stored fare fallback", () => {
  assert.equal(resolveLockedTripFare({ finalFare: null, fareAmount: 86, estimatedFare: 90 }), 86);
  assert.equal(resolveLockedTripFare({ finalFare: null, fareAmount: null, estimatedFare: 95 }), 95);
  assert.equal(resolveLockedTripFare({ originalFare: 110 }), 110);
  assert.equal(resolveLockedTripFare({ legacyFallbackFare: 40 }), 40);
  assert.equal(resolveLockedTripFare({}), null);
});

test("a stop added after booking increases only the locked fare", () => {
  assert.deepEqual(
    addIncrementalStopCharge({
      currentFare: 76,
      previousStopIncrease: 0,
      nextStopIncrease: 18,
    }),
    {
      currentFare: 76,
      previousStopIncrease: 0,
      nextStopIncrease: 18,
      addedStopCharge: 18,
      finalFare: 94,
    },
  );
});

test("pre-booking and earlier active stops are not charged twice", () => {
  assert.equal(
    addIncrementalStopCharge({
      currentFare: 95,
      previousStopIncrease: 10,
      nextStopIncrease: 25,
    })?.finalFare,
    110,
  );
  assert.equal(
    addIncrementalStopCharge({
      currentFare: 110,
      previousStopIncrease: 25,
      nextStopIncrease: 37,
    })?.finalFare,
    122,
  );
});

test("route changes cannot reduce or otherwise recalculate the locked fare", () => {
  assert.equal(
    addIncrementalStopCharge({
      currentFare: 94,
      previousStopIncrease: 18,
      nextStopIncrease: 16,
    })?.finalFare,
    94,
  );
});

test("repeating the same cumulative stop increase adds no duplicate charge", () => {
  assert.deepEqual(
    addIncrementalStopCharge({
      currentFare: 110,
      previousStopIncrease: 25,
      nextStopIncrease: 25,
    }),
    {
      currentFare: 110,
      previousStopIncrease: 25,
      nextStopIncrease: 25,
      addedStopCharge: 0,
      finalFare: 110,
    },
  );
});
