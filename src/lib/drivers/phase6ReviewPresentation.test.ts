import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node strip-types tests require the explicit extension.
import { evidenceItems, queueGroup, reviewCompletion, reviewDraft, PHASE6_EVIDENCE_LABELS } from "./phase6ReviewPresentation.ts";

test("evidence labels bind by semantic requirement and UUID, not upload order", () => {
  const draft = { personal: { evidence: { id_document: "id-1" } }, driving: { evidence: { drivers_license: "lic-1" } }, vehicle: { evidence: { vehicle_license_disc: "disc-1" } }, scanner: { evidence: { rear: "rear-1", front: "front-1" } } };
  const uploads = [
    { id: "front-1", section: "scanner", state: "VALIDATED" },
    { id: "rear-1", section: "scanner", state: "VALIDATED" },
    { id: "disc-1", section: "vehicle", state: "VALIDATED" },
    { id: "lic-1", section: "driving", state: "VALIDATED" },
    { id: "id-1", section: "personal", state: "VALIDATED" },
  ];
  const items = evidenceItems(draft, uploads);
  assert.equal(items.find(item => item.requirement === "rear")?.upload?.id, "rear-1");
  assert.equal(items.find(item => item.requirement === "rear")?.label, "Rear of Vehicle");
  assert.equal(items.find(item => item.requirement === "front")?.upload?.id, "front-1");
  assert.equal(items.find(item => item.requirement === "id_document")?.label, "SA ID");
  assert.equal(items.find(item => item.requirement === "drivers_license")?.label, "Driver's Licence");
  assert.equal(items.find(item => item.requirement === "pdp")?.required, false);
  assert.equal(reviewCompletion(draft, uploads).received, 5);
});

test("wrong-section and unvalidated uploads do not count as received", () => {
  const draft = { scanner: { evidence: { rear: "x", front: "y" } } };
  const items = evidenceItems(draft, [{ id: "x", section: "personal", state: "VALIDATED" }, { id: "y", section: "scanner", state: "FAILED" }]);
  assert.equal(items.find(item => item.requirement === "rear")?.upload, null);
  assert.equal(reviewCompletion(draft, []).received, 0);
});

test("current immutable snapshot is review authority", () => {
  assert.deepEqual(reviewDraft({ personal: { first_name: "Draft" } }, [{ version: 1, snapshot: { draft: { personal: { first_name: "Submitted" } } } }], 1), { personal: { first_name: "Submitted" } });
});

test("all evidence keys have distinct human labels", () => {
  assert.equal(Object.keys(PHASE6_EVIDENCE_LABELS).length, new Set(Object.values(PHASE6_EVIDENCE_LABELS)).size);
  for (const key of ["front", "rear", "driver_side", "passenger_side", "front_interior", "rear_interior", "odometer", "vin", "engine", "vehicle_license_disc"]) assert.ok(PHASE6_EVIDENCE_LABELS[key]);
  assert.equal(queueGroup("RESUBMITTED"), "review");
  assert.equal(queueGroup("CORRECTION_REQUESTED"), "driver");
  assert.equal(queueGroup("DRAFT"), "draft");
});
