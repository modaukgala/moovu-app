import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node strip-types tests require an explicit extension.
import { findAwayDrivers } from "./awayDriverPolicy.ts";

const o = (driver_id: string, status: string, offered_at: string) => ({ driver_id, status, offered_at });

test("driver who missed 2 offers and was not seen since is away", () => {
  const away = findAwayDrivers([o("a", "expired", "2026-11-27T15:00:00Z"), o("a", "expired", "2026-11-27T16:00:00Z")],
    new Map([["a", "2026-11-27T09:00:00Z"]]));
  assert.deepEqual([...away], ["a"]);
});
test("driver seen after the missed offers stays online", () => {
  const away = findAwayDrivers([o("a", "expired", "2026-11-27T15:00:00Z"), o("a", "expired", "2026-11-27T16:00:00Z")],
    new Map([["a", "2026-11-27T15:30:00Z"]]));
  assert.equal(away.size, 0);
});
test("one miss, or an accepted/taken offer, is not away", () => {
  assert.equal(findAwayDrivers([o("a", "expired", "2026-11-27T16:00:00Z")], new Map([["a", null]])).size, 0);
  assert.equal(findAwayDrivers([o("a", "expired", "2026-11-27T15:00:00Z"), o("a", "cancelled", "2026-11-27T16:00:00Z")],
    new Map([["a", null]])).size, 0);
});
