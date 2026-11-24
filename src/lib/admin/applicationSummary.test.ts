import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner requires an explicit TypeScript extension.
import { applicantSearchText, applicationSummary, currentPhase6ByDriver } from "./applicationSummary.ts";

test("selects the highest application cycle deterministically", () => {
  const rows = [
    { id: "a", driver_id: "d", cycle: 1, status: "APPROVED", updated_at: "2026-01-01" },
    { id: "b", driver_id: "d", cycle: 2, status: "UNDER_REVIEW", updated_at: "2026-02-01" },
  ];
  assert.equal(currentPhase6ByDriver(rows).get("d")?.id, "b");
});

test("keeps approval decision independent of application and operating status", () => {
  const result = applicationSummary({
    driverId: "d",
    verificationStatus: "inactive",
    phase6: { id: "a", driver_id: "d", cycle: 3, status: "APPROVED", updated_at: "2026-03-01" },
    decision: { action: "APPROVED", created_at: "2026-03-02" },
  });
  assert.equal(result.decision, "APPROVED");
  assert.equal(result.decisionAt, "2026-03-02");
});

test("human-readable applicant search finds submitted data beyond the first page", () => {
  const records = Array.from({ length: 150 }, (_, index) => ({
    snapshot: { personal: { first_name: index === 120 ? "Nomvula" : `Driver${index}`, last_name: "Test", phone: index === 120 ? "0825550199" : null } },
    driver: index === 120 ? { email: "nomvula@example.test" } : null,
  }));
  for (const term of ["nomvula", "0825550199", "nomvula@example.test"]) {
    assert.equal(records.findIndex((record) => applicantSearchText(record).includes(term)), 120);
  }
});
