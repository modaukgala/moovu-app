import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { createRouteSignature, isMapCircuitLimitReached, normalizeCoordinate } from "./mapRequestPolicy.ts";

test("route signatures ignore sub-meter coordinate noise", () => {
  const first = createRouteSignature({
    origin: { lat: -25.123451, lng: 29.123451 },
    destination: { lat: -25.223451, lng: 29.223451 },
  });
  const second = createRouteSignature({
    origin: { lat: -25.123452, lng: 29.123452 },
    destination: { lat: -25.223452, lng: 29.223452 },
  });
  assert.equal(first, second);
});

test("route signatures change when the destination materially changes", () => {
  const first = createRouteSignature({
    origin: { lat: -25.12, lng: 29.05 },
    destination: { lat: -25.22, lng: 29.15 },
  });
  const second = createRouteSignature({
    origin: { lat: -25.12, lng: 29.05 },
    destination: { lat: -25.23, lng: 29.16 },
  });
  assert.notEqual(first, second);
});

test("normalization retains roughly meter-level route identity", () => {
  assert.equal(normalizeCoordinate(-25.1234567), -25.12346);
});

test("route circuit opens at the configured provider threshold", () => {
  assert.equal(isMapCircuitLimitReached("route", 89), false);
  assert.equal(isMapCircuitLimitReached("route", 90), true);
});
