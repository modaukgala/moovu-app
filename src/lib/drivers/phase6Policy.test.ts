import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types runner requires an explicit TypeScript extension.
import { phase6Editable, phase6PdpNotice, phase6DraftShape, validSaIdentity, PHASE6_CHECKLIST, type Phase6Application } from "./phase6Policy.ts";

const base: Phase6Application = { id: "application", driver_id: "driver", cycle: 1, revision: 0, version: 0, status: "DRAFT", draft: {}, correction_sections: [] };
test("draft input cannot claim verification or review authority", () => {
  assert.equal(phase6DraftShape({ personal: { verification_status: "approved" } }), false);
  assert.equal(phase6DraftShape({ driving: { pdp_status: "verified" } }), false);
  assert.equal(phase6DraftShape({ review: { reviewer: "owner" } }), false);
  assert.equal(phase6DraftShape({ personal: { first_name: "Driver" } }), true);
});
test("evidence accepts only declared requirements and UUID references", () => {
  assert.equal(phase6DraftShape({ personal: { evidence: { id_document: "private/path.jpg" } } }), false);
  assert.equal(phase6DraftShape({ vehicle: { evidence: { roadworthy: "12345678-1234-1234-1234-123456789abc" } } }), false);
  assert.equal(phase6DraftShape({ vehicle: { evidence: { insurance: "12345678-1234-1234-1234-123456789abc" } } }), true);
});
test("submitted, approved and rejected records cannot reopen through Driver edits", () => {
  for (const status of ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"]) assert.equal(phase6Editable({ ...base, status }, "personal"), false);
  assert.equal(phase6Editable(base, "personal"), true);
});
test("requested correction opens only authorized sections", () => {
  const correction = { ...base, status: "CORRECTION_REQUESTED", correction_sections: ["vehicle"] };
  assert.equal(phase6Editable(correction, "vehicle"), true);
  assert.equal(phase6Editable(correction, "personal"), false);
  assert.equal(phase6Editable(correction, "driving"), false);
});
test("manual checklist retains six views and three identification captures", () => {
  assert.deepEqual(PHASE6_CHECKLIST, ["front", "rear", "driver_side", "passenger_side", "front_interior", "rear_interior", "odometer", "vin", "engine"]);
});
test("PDP evidence does not imply legal permission or verification", () => {
  assert.match(phase6PdpNotice({}), /30 November 2026/);
  assert.match(phase6PdpNotice({}), /does not establish legal permission/);
  assert.match(phase6PdpNotice({ driving: { evidence: { pdp: "capture" } } }), /verification pending/);
  assert.doesNotMatch(phase6PdpNotice({ driving: { evidence: { pdp: "capture" } } }), /must be obtained/);
});
test("identity check rejects missing values, malformed dates and corrupt checksum", () => {
  assert.equal(validSaIdentity(undefined), false);
  assert.equal(validSaIdentity("9002315000080"), false);
  // Synthetic checksum-correct format is validation input, never a stored identity.
  const prefix = "900101500008";
  const valid = Array.from({ length: 10 }, (_, n) => prefix + n).find(validSaIdentity);
  assert.ok(valid);
  assert.equal(validSaIdentity(valid.slice(0, 12) + ((Number(valid[12]) + 1) % 10)), false);
});
