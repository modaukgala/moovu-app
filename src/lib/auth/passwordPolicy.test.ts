import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node strip-types uses explicit extensions.
import { validNewPassword } from "./passwordPolicy.ts";

test("owner policy accepts eight characters without requiring symbols", () => {
  for (const value of ["Moovu123", "Driver2026", "Welcome8", "Moovu123!"]) assert.equal(validNewPassword(value), true);
});
test("owner policy rejects missing classes and short passwords", () => {
  for (const value of ["moovu123", "MOOVU123", "MoovuApp", "Movu123", "", "12345678"]) assert.equal(validNewPassword(value), false);
});
