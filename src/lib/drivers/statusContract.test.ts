import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { DEFAULT_DRIVER_VERIFICATION_STATUS, isDriverVerificationAction, persistedDriverVerificationStatus } from "./statusContract.ts";

test("more-information requests persist as pending review", () => {
  assert.equal(persistedDriverVerificationStatus("needs_more_info"), "pending_review");
});

test("canonical approval and rejection states remain unchanged", () => {
  assert.equal(persistedDriverVerificationStatus("approved"), "approved");
  assert.equal(persistedDriverVerificationStatus("rejected"), "rejected");
  assert.equal(DEFAULT_DRIVER_VERIFICATION_STATUS, "pending_review");
});

test("unsupported database verification labels are rejected", () => {
  assert.equal(isDriverVerificationAction("deleted"), false);
  assert.equal(isDriverVerificationAction("deactivated"), false);
  assert.equal(isDriverVerificationAction("needs_more_info"), true);
});
