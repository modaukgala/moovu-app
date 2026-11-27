import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types tests require the explicit extension.
import { driverStage, draftIsEmpty, missingItems, resolveDriverName } from "./driverDirectory.ts";

test("placeholder 'Pending Driver' is replaced by the name typed in the application", () => {
  assert.equal(resolveDriverName({ first_name: "Pending", last_name: "Driver", draft: { personal: { first_name: " Siyabonga ", last_name: "Mpokwane " } } }).name, "Siyabonga Mpokwane");
  assert.equal(resolveDriverName({ first_name: "Pending", last_name: "Driver", email: "a@b.co", draft: {} }).name, "No name yet (a@b.co)");
  assert.equal(resolveDriverName({ first_name: "Pending", last_name: "Driver", legacyFullName: "Old Name" }).name, "Old Name");
  assert.equal(resolveDriverName({ first_name: "Thabo", last_name: "Nkosi" }).name, "Thabo Nkosi");
});

test("one stage per driver across old and new systems", () => {
  assert.equal(driverStage({ status: "approved", verification_status: "approved", applicationStatus: null, draft: null }), "active");
  assert.equal(driverStage({ status: "pending", verification_status: "pending_review", applicationStatus: "DRAFT", draft: {} }), "not_started");
  assert.equal(driverStage({ status: "pending", verification_status: "pending_review", applicationStatus: "DRAFT", draft: { personal: { first_name: "A" } } }), "draft");
  assert.equal(driverStage({ status: "pending", verification_status: null, applicationStatus: "SUBMITTED", draft: null }), "review");
  assert.equal(driverStage({ status: "inactive", verification_status: "approved", applicationStatus: "APPROVED", draft: null }), "deactivated");
  assert.equal(driverStage({ status: "pending", verification_status: null, applicationStatus: null, draft: null }), "old_system");
});

test("missing items are listed in plain words", () => {
  assert.equal(draftIsEmpty({ personal: {}, driving: {} }), true);
  const missing = missingItems({ personal: { first_name: "A" } });
  assert.ok(missing.includes("Last name"));
  assert.ok(missing.includes("ID document (photo)"));
  assert.ok(!missing.includes("First name"));
});
