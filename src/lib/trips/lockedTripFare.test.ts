import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { buildLockedFareBreakdown, resolveLockedTripFare } from "./lockedTripFare.ts";

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
