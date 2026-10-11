import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types tests require an explicit extension.
import { isNinetySecondDispatchEnabledFor, matchingRadiusKm, matchingStep, nextMatchingStepAt } from "./matchingWindowPolicy.ts";

test("paid search expands earlier but both methods retain every slot and a 20 km cap", () => {
  assert.deepEqual(Array.from({ length: 9 }, (_, step) => matchingRadiusKm(step, false)),
    [8, 8, 8, 14, 14, 14, 20, 20, 20]);
  assert.deepEqual(Array.from({ length: 9 }, (_, step) => matchingRadiusKm(step, true)),
    [14, 14, 14, 20, 20, 20, 20, 20, 20]);
});

test("offers have slots at 0 through 80 seconds and no slot after 90", () => {
  const started = Date.parse("2026-10-10T00:00:00Z");
  for (let second = 0; second < 90; second += 10) {
    assert.equal(matchingStep(started, started + second * 1000), second / 10);
    assert.equal(nextMatchingStepAt(started, started + second * 1000), started + (second + 10) * 1000);
  }
  assert.equal(matchingStep(started, started + 90_000), 9);
  assert.equal(nextMatchingStepAt(started, started + 90_000), started + 90_000);
});

test("activation requires a valid effective timestamp and excludes older trips", () => {
  const effective = "2026-10-10T12:00:00Z";
  assert.equal(isNinetySecondDispatchEnabledFor(effective, "false", effective), false);
  assert.equal(isNinetySecondDispatchEnabledFor(effective, "true", undefined), false);
  assert.equal(isNinetySecondDispatchEnabledFor("2026-10-10T11:59:59Z", "true", effective), false);
  assert.equal(isNinetySecondDispatchEnabledFor(effective, "true", effective), true);
  assert.equal(isNinetySecondDispatchEnabledFor("2026-10-10T12:00:01Z", "true", effective), true);
});
