import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { calculateAddStopIncrease, calculateFinalJourneyFare, calculateTripFare, getDistanceTierDiscountPct, resolveAdminTripFare } from "./fare.ts";

test("distance-tier discount boundaries match the approved model", () => {
  const cases = [
    [1, 0],
    [5, 0],
    [10, 0],
    [10.01, 15],
    [12, 15],
    [18, 15],
    [18.01, 30],
    [20, 30],
    [50, 30],
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

  assert.equal(normal.distanceDiscountPct, 30);
  assert.equal(normal.longDistanceUpliftAmount, 0);
  assert.equal(
    normal.fareBeforeMinimum,
    Number((normal.fareBeforeDistanceDiscount * 0.7).toFixed(2)),
  );
  assert.ok(busy.fareBeforeDistanceDiscount > normal.fareBeforeDistanceDiscount);
  assert.equal(busy.distanceDiscountPct, 30);
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
  assert.equal(journey.distanceDiscountPct, 15);
  assert.equal(
    journey.distanceDiscountAmount,
    Number(((fare.fareBeforeDistanceDiscount + 30) * 0.15).toFixed(2)),
  );
});

test("minimum fares rise with every approved surge mode", () => {
  const cases = [
    ["go", "normal", 40],
    ["go", "busy", 44],
    ["go", "heavy_demand", 48],
    ["go", "rain_event", 56],
    ["group", "normal", 70],
    ["group", "busy", 77],
    ["group", "heavy_demand", 84],
    ["group", "rain_event", 98],
  ] as const;

  for (const [rideOptionId, surgeLabel, expectedFare] of cases) {
    const fare = calculateTripFare({
      distanceKm: 0.1,
      durationMin: 0.1,
      rideOptionId,
      surgeLabel,
    });
    assert.equal(fare.effectiveMinimumFare, expectedFare);
    assert.equal(fare.totalFare, expectedFare);
  }
});

test("Admin fare defaults to server calculation and overrides require a reason", () => {
  assert.deepEqual(resolveAdminTripFare({ calculatedFare: 56, overrideFare: 10 }), {
    amount: 56,
    overridden: false,
    reason: null,
  });
  assert.throws(
    () => resolveAdminTripFare({ calculatedFare: 56, overrideRequested: true, overrideFare: 60 }),
    /reason is required/i,
  );
  assert.deepEqual(
    resolveAdminTripFare({
      calculatedFare: 56,
      overrideRequested: true,
      overrideFare: 60,
      overrideReason: "Operator confirmed a negotiated fare",
    }),
    { amount: 60, overridden: true, reason: "Operator confirmed a negotiated fare" },
  );
});

test("add-stop variable charges use the trip's locked surge and legacy defaults to normal", () => {
  const legacy = calculateAddStopIncrease({
    rideOptionId: "go",
    originalDistanceKm: 2,
    originalDurationMin: 5,
    routeDistanceKm: 4,
    routeDurationMin: 10,
    stopCount: 1,
  });
  const lockedBusy = calculateAddStopIncrease({
    rideOptionId: "go",
    originalDistanceKm: 2,
    originalDurationMin: 5,
    routeDistanceKm: 4,
    routeDurationMin: 10,
    stopCount: 1,
    surgeMultiplier: 1.1,
  });

  assert.equal(legacy.surgeMultiplier, 1);
  assert.equal(legacy.variableSurgeAmount, 0);
  assert.equal(lockedBusy.surgeMultiplier, 1.1);
  assert.ok(lockedBusy.finalAddStopIncrease > legacy.finalAddStopIncrease);
});
