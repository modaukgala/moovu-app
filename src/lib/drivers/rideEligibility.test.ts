import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { getDriverRideEligibility, isDriverEligibleForRideOption } from "./rideEligibility.ts";

test("driver ride eligibility follows approved seating rules", () => {
  assert.deepEqual(getDriverRideEligibility(4).eligibleRideOptions, ["go"]);
  assert.deepEqual(getDriverRideEligibility(5).eligibleRideOptions, ["go"]);
  assert.equal(getDriverRideEligibility(5).reviewRequired, false);
  assert.deepEqual(getDriverRideEligibility(6).eligibleRideOptions, ["go"]);
  assert.equal(getDriverRideEligibility(6).reviewRequired, true);
  assert.deepEqual(getDriverRideEligibility(7).eligibleRideOptions, ["go", "group"]);
  assert.equal(getDriverRideEligibility(7).reviewRequired, false);
});

test("MOOVU Go Plus never reaches a Go-only driver", () => {
  assert.equal(isDriverEligibleForRideOption(5, "group"), false);
  assert.equal(isDriverEligibleForRideOption(6, "group"), false);
  assert.equal(isDriverEligibleForRideOption(7, "group"), true);
  assert.equal(isDriverEligibleForRideOption(7, "go"), true);
});
