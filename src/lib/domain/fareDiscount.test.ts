import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { calculateFinalJourneyFare, calculateTripFare, getDistanceTierDiscountPct } from "./fare.ts";

test("distance-tier discount boundaries match the approved model", () => {
  const cases = [
    [1, 0],
    [5, 0],
    [10, 0],
    [10.01, 8],
    [12, 8],
    [18, 8],
    [18.01, 20],
    [20, 20],
    [50, 20],
  ] as const;

  for (const [distanceKm, expectedPct] of cases) {
    assert.equal(getDistanceTierDiscountPct(distanceKm), expectedPct);
  }
});

test("discount applies after surge and before minimum fare and rounding", () => {
  const normal = calculateTripFare({
    distanceKm: 20,
    durationMin: 30,
    rideOptionId: "go",
    surgeLabel: "normal",
  });
  const busy = calculateTripFare({
    distanceKm: 20,
    durationMin: 30,
    rideOptionId: "go",
    surgeLabel: "busy",
  });

  assert.equal(normal.distanceDiscountPct, 20);
  assert.equal(normal.longDistanceUpliftAmount, 0);
  assert.equal(
    normal.fareBeforeMinimum,
    Number((normal.fareBeforeDistanceDiscount * 0.8).toFixed(2)),
  );
  assert.ok(busy.fareBeforeDistanceDiscount > normal.fareBeforeDistanceDiscount);
  assert.equal(busy.distanceDiscountPct, 20);
});

test("total route distance selects the tier for add-stop journeys", () => {
  const fare = calculateTripFare({
    distanceKm: 9,
    distanceDiscountKm: 0,
    durationMin: 15,
    rideOptionId: "group",
  });
  const journey = calculateFinalJourneyFare({
    baseFare: fare,
    routeDistanceKm: 12,
    addStopIncrease: 30,
  });

  assert.equal(fare.distanceKm, 9);
  assert.equal(journey.distanceDiscountKm, 12);
  assert.equal(journey.distanceDiscountPct, 8);
  assert.equal(
    journey.distanceDiscountAmount,
    Number(((fare.fareBeforeDistanceDiscount + 30) * 0.08).toFixed(2)),
  );
});
