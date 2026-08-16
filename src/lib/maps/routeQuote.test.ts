import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { createRouteQuote, verifyRouteQuote } from "./routeQuote.ts";

const route = {
  routeSignature: "origin|destination||driving",
  distanceMeters: 8_000,
  durationSeconds: 900,
  distanceKm: 8,
  durationMin: 15,
  originalDistanceMeters: 8_000,
  originalDurationSeconds: 900,
  originalDistanceKm: 8,
  originalDurationMin: 15,
  extraDistanceKm: 0,
  extraDurationMin: 0,
  stopCount: 0,
  originAddress: null,
  destinationAddress: null,
};

test("a signed route quote can be reused for its matching route", () => {
  const token = createRouteQuote(route, { secret: "test-secret", now: 1_000, ttlMs: 5_000 });
  const verified = verifyRouteQuote(token, route.routeSignature, { secret: "test-secret", now: 2_000 });
  assert.equal(verified?.distanceKm, 8);
});

test("route quotes reject route changes and expiry", () => {
  const token = createRouteQuote(route, { secret: "test-secret", now: 1_000, ttlMs: 500 });
  assert.equal(verifyRouteQuote(token, "changed-route", { secret: "test-secret", now: 1_100 }), null);
  assert.equal(verifyRouteQuote(token, route.routeSignature, { secret: "test-secret", now: 1_600 }), null);
});
