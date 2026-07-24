import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { bestReverseGeocodeLabel, parsePastedLocation } from "./locationPaste.ts";

test("parses pasted coordinates as an exact location", () => {
  const result = parsePastedLocation("-25.746111, 28.188056");

  assert.deepEqual(result, {
    kind: "coordinates",
    lat: -25.746111,
    lng: 28.188056,
    source: "text",
    raw: "-25.746111, 28.188056",
  });
});

test("parses coordinates from a Google Maps link", () => {
  const result = parsePastedLocation(
    "https://www.google.com/maps/search/?api=1&query=-25.746111%2C28.188056"
  );

  assert.equal(result.kind, "coordinates");
  if (result.kind !== "coordinates") return;
  assert.equal(result.lat, -25.746111);
  assert.equal(result.lng, 28.188056);
  assert.equal(result.source, "google-url");
});

test("keeps Plus Codes available as a supported location input", () => {
  const result = parsePastedLocation("V3M2+XW Siyabuswa");

  assert.equal(result.kind, "plus_code");
  if (result.kind !== "plus_code") return;
  assert.equal(result.plusCode, "V3M2+XW Siyabuswa");
});

test("prefers a useful nearby-place label over address and Plus Code metadata", () => {
  const label = bestReverseGeocodeLabel(
    {
      ok: true,
      label: "Menlyn Park Shopping Centre",
      formattedAddress: "Atterbury Road, Pretoria",
      globalPlusCode: "5G5H+88 Pretoria",
    },
    "Pinned destination"
  );

  assert.equal(label, "Menlyn Park Shopping Centre");
});

test("uses a clean fallback when reverse geocoding has no metadata", () => {
  const label = bestReverseGeocodeLabel({ ok: true }, "Pinned pickup location");

  assert.equal(label, "Pinned pickup location");
});
