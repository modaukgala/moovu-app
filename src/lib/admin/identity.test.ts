import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node strip-types tests require the explicit extension.
import { adminDriverName, adminPersonName } from "./identity.ts";

test("Admin identity uses the person's name without changing the canonical ID", () => {
  const driver = { id: "8f33e8d8-3e41-4b2e-bdb6-48007f3d16eb", first_name: " Thabo ", last_name: " Mokoena " };
  assert.equal(adminDriverName(driver), "Thabo Mokoena");
  assert.equal(driver.id, "8f33e8d8-3e41-4b2e-bdb6-48007f3d16eb");
});

test("missing names never surface an ID as the primary Admin identity", () => {
  assert.equal(adminDriverName({ first_name: "", last_name: null }), "Unnamed Driver");
  assert.equal(adminDriverName(null), "Driver profile unavailable");
  assert.equal(adminPersonName({ first_name: "Nomsa", last_name: null }, "Customer name unavailable"), "Nomsa");
});
