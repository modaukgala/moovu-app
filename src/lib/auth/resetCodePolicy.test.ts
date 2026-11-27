import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node strip-types tests require an explicit extension.
import { newResetCode, checkResetCode } from "./resetCodePolicy.ts";

test("reset code works once-shaped: right, wrong, expired, locked", () => {
  const now = Date.parse("2026-11-28T00:00:00Z");
  const { code, stored } = newResetCode("u1", now);
  assert.match(code, /^\d{6}$/);
  assert.equal(checkResetCode("u1", code, stored, now), "ok");
  assert.equal(checkResetCode("u2", code, stored, now), "wrong");
  assert.equal(checkResetCode("u1", code === "000000" ? "111111" : "000000", stored, now), "wrong");
  assert.equal(checkResetCode("u1", code, stored, now + 16 * 60_000), "expired");
  assert.equal(checkResetCode("u1", code, { ...stored, tries: 5 }, now), "locked");
  assert.equal(checkResetCode("u1", code, null, now), "none");
});
