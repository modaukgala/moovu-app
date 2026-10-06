import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node strip-types requires explicit extensions.
import { existingDriverDraft, mergeMissingDriverDetails, onboardingDriverName, reusableLegacyDocument } from "./onboardingTransition.ts";
test("existing fields exclude identity, finances and review authority", () => {
  const draft = existingDriverDraft({ id: "same-driver", first_name: "Existing", vehicle_year: 2020, balance_due: 5000, status: "active" }, { license_number: "existing-license" });
  assert.equal(draft.personal?.first_name, "Existing");
  assert.equal(draft.vehicle?.vehicle_year, "2020");
  assert.equal(draft.driving?.license_number, "existing-license");
  assert.doesNotMatch(JSON.stringify(draft), /same-driver|balance_due|active/);
});
test("saved evidence and entered values win over existing defaults", () => {
  const draft = mergeMissingDriverDetails({ personal: { first_name: "Corrected", evidence: { id_document: "saved" } } }, { personal: { first_name: "Legacy", last_name: "Preserved" } });
  assert.equal(draft.personal?.first_name, "Corrected");
  assert.equal(draft.personal?.last_name, "Preserved");
  assert.deepEqual(draft.personal?.evidence, { id_document: "saved" });
});
test("only approved unexpired legacy evidence is reusable", () => {
  assert.equal(reusableLegacyDocument({ status: "approved", expires_on: "2030-01-01" }, Date.parse("2026-01-01")), true);
  assert.equal(reusableLegacyDocument({ status: "rejected" }), false);
  assert.equal(reusableLegacyDocument({ review_status: "verified", expires_on: "2020-01-01" }), false);
  assert.equal(reusableLegacyDocument({ status: "approved", expires_on: "invalid" }), false);
});
test("Admin sees the submitted applicant name before canonical approval", () => {
  assert.equal(onboardingDriverName({ personal: { first_name: "New", last_name: "Applicant" } }, { first_name: "Pending", last_name: "Driver" }), "New Applicant");
  assert.equal(onboardingDriverName({}, { first_name: "Existing", last_name: "Driver" }), "Existing Driver");
});
