import assert from "node:assert/strict";
import test from "node:test";
import { formatFareRands } from "./fareDisplay.ts";

test("whole-rand fares omit cents while historical fractional fares stay exact", () => {
  assert.equal(formatFareRands(78), "R78");
  assert.equal(formatFareRands(77.75), "R77.75");
});
