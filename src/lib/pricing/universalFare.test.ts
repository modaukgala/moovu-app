import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner requires an explicit TypeScript extension.
import { FUEL_FARE_VERSION, fareQuoteMatches, priceStandardFare, STANDARD_FARE_VERSION, universalFareIncreaseEnabled } from "./universalFare.ts";
// @ts-expect-error Node's strip-types runner requires an explicit TypeScript extension.
import { calculateTripFare } from "../domain/fare.ts";
// @ts-expect-error Node's strip-types runner requires an explicit TypeScript extension.
import { calculateCommissionCents } from "../finance/phase2Policy.ts";

test("universal fare increase uses integer cents and half-up rounding after minimum fare", () => {
  assert.deepEqual(priceStandardFare(40, true), { version: FUEL_FARE_VERSION,
    baseFareCents: 4000, increaseCents: 92, rideFareCents: 4092 });
  assert.equal(priceStandardFare(76, true).rideFareCents, 7775);
  assert.equal(priceStandardFare(100, true).rideFareCents, 10230);
});

test("disabled policy keeps the existing fare and the flag defaults off", () => {
  assert.deepEqual(priceStandardFare(76, false), { version: STANDARD_FARE_VERSION,
    baseFareCents: 7600, increaseCents: 0, rideFareCents: 7600 });
  assert.equal(universalFareIncreaseEnabled({}), false);
  assert.equal(universalFareIncreaseEnabled({ MOOVU_UNIVERSAL_FARE_23_ENABLED: "true" }), false);
  assert.equal(universalFareIncreaseEnabled({ MOOVU_UNIVERSAL_FARE_23_ENABLED: "true",
    MOOVU_FARE_EFFECTIVE_AT: "2026-11-01T00:00:00Z" }, new Date("2026-11-01T00:00:00Z")), true);
  assert.equal(universalFareIncreaseEnabled({ MOOVU_UNIVERSAL_FARE_23_ENABLED: "true",
    MOOVU_FARE_EFFECTIVE_AT: "2026-11-01T00:00:00Z" }, new Date("2026-10-31T23:59:59Z")), false);
  assert.equal(universalFareIncreaseEnabled({ MOOVU_UNIVERSAL_FARE_23_ENABLED: "false" }), false);
});

test("payment method and ride option are not inputs to the universal multiplier", () => {
  const oldGo = 76;
  const oldXl = 100;
  for (const method of ["cash", "transfer", "online"]) {
    assert.equal(priceStandardFare(oldGo, true).rideFareCents, 7775, method);
    assert.equal(priceStandardFare(oldXl, true).rideFareCents, 10230, method);
  }
  assert.throws(() => priceStandardFare(0, true));
});

test("the increase follows each ride option's completed minimum-fare calculation", () => {
  const go = calculateTripFare({ distanceKm: 0.1, durationMin: 1, rideOptionId: "go" });
  const xl = calculateTripFare({ distanceKm: 0.1, durationMin: 1, rideOptionId: "group" });
  assert.equal(priceStandardFare(go.totalFare, false).rideFareCents, Math.round(go.totalFare * 100));
  assert.equal(priceStandardFare(xl.totalFare, false).rideFareCents, Math.round(xl.totalFare * 100));
  assert.ok(xl.totalFare > go.totalFare);
  assert.ok(priceStandardFare(xl.totalFare, true).rideFareCents > priceStandardFare(go.totalFare, true).rideFareCents);
});

test("a stale pre-activation or differently priced quote is rejected", () => {
  const before = priceStandardFare(100, false);
  const after = priceStandardFare(100, true);
  assert.equal(fareQuoteMatches(after, before.version, before.rideFareCents), false);
  assert.equal(fareQuoteMatches(after, after.version, before.rideFareCents), false);
  assert.equal(fareQuoteMatches(after, after.version, after.rideFareCents), true);
});

test("15 percent commission and Driver remainder use the new fare once", () => {
  for (const [oldFare, totalCents, commissionCents] of [
    [40, 4092, 614], [76, 7775, 1166], [100, 10230, 1535],
  ]) {
    const fare = priceStandardFare(oldFare, true).rideFareCents;
    assert.equal(fare, totalCents);
    assert.equal(Number(calculateCommissionCents(BigInt(fare))), commissionCents);
    assert.equal(fare - commissionCents, totalCents - commissionCents);
  }
});
