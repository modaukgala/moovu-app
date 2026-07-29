import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { selectMapPickerInitialLocation } from "./bookingMapLocation.ts";

const now = 1_800_000_000_000;
const pickup = { lat: -25.11, lng: 29.06 };
const destination = { lat: -25.08, lng: 29.09 };

test("pickup selection prefers its confirmed coordinates", () => {
  const result = selectMapPickerInitialLocation({
    kind: "pickup",
    pickup,
    destination,
    sessionLocation: { lat: -26.18, lng: 28.32, capturedAt: now },
    now,
  });

  assert.deepEqual(result, { location: pickup, source: "confirmed_pickup" });
});

test("destination selection prefers destination then pickup", () => {
  assert.deepEqual(
    selectMapPickerInitialLocation({
      kind: "dropoff",
      pickup,
      destination,
      sessionLocation: null,
      now,
    }),
    { location: destination, source: "confirmed_destination" },
  );

  assert.deepEqual(
    selectMapPickerInitialLocation({
      kind: "dropoff",
      pickup,
      destination: null,
      sessionLocation: null,
      now,
    }),
    { location: pickup, source: "confirmed_pickup" },
  );
});

test("fresh GPS is used but a stale cross-session location is rejected", () => {
  const fresh = { lat: -25.12, lng: 29.07, capturedAt: now - 30_000 };
  const staleBenoni = { lat: -26.188, lng: 28.3206, capturedAt: now - 31 * 60 * 1000 };

  assert.equal(
    selectMapPickerInitialLocation({
      kind: "pickup",
      pickup: null,
      destination: null,
      sessionLocation: fresh,
      now,
    }).source,
    "live_gps",
  );

  assert.deepEqual(
    selectMapPickerInitialLocation({
      kind: "pickup",
      pickup: null,
      destination: null,
      sessionLocation: staleBenoni,
      now,
    }),
    { location: null, source: "operating_area" },
  );
});

test("only pickup can reuse an older location from the current booking session", () => {
  const sessionLocation = { lat: -25.13, lng: 29.08, capturedAt: now - 5 * 60 * 1000 };

  assert.equal(
    selectMapPickerInitialLocation({
      kind: "pickup",
      pickup: null,
      destination: null,
      sessionLocation,
      now,
    }).source,
    "session_location",
  );

  assert.equal(
    selectMapPickerInitialLocation({
      kind: "dropoff",
      pickup: null,
      destination: null,
      sessionLocation,
      now,
    }).source,
    "operating_area",
  );
});
