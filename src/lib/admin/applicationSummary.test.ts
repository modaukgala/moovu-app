import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node strip-types tests require the explicit extension.
import { adminApplicationLabel, currentPhase6ByDriver, driverAdminSummary, phase6NeedsReviewCount } from "./applicationSummary.ts";

test("the Phase 6 needs-review metric matches the review queue population", () => {
  const rows = ["DRAFT", "SUBMITTED", "RESUBMITTED", "UNDER_REVIEW", "CORRECTION_REQUESTED", "APPROVED", "REJECTED"]
    .map(status => ({ status }));
  assert.equal(phase6NeedsReviewCount(rows), 3);
});

test("latest cycle belongs to the same canonical Driver and preserves earlier cycles", () => {
  const rows = [
    { id: "first", driver_id: "driver-1", cycle: 1, status: "APPROVED", updated_at: "2026-09-01" },
    { id: "second", driver_id: "driver-1", cycle: 2, status: "CORRECTION_REQUESTED", updated_at: "2026-10-01" },
  ];
  const current = currentPhase6ByDriver(rows).get("driver-1");
  assert.equal(current?.id, "second");
  assert.equal(rows.length, 2);
  const summary = driverAdminSummary({ id: "driver-1", status: "active", verification_status: "approved",
    online: true, busy: false, phase6: current, existingDriver: true }, "2026-10-08T00:00:00Z");
  assert.equal(summary.application?.driverId, "driver-1");
  assert.equal(summary.application?.source, "phase6");
  assert.equal(summary.application?.existingDriver, true);
  assert.equal(summary.onboardingReadiness.state, "driver_action");
  assert.equal(summary.operationalEligibility.state, "not_evaluated");
  assert.match(adminApplicationLabel(summary), /Existing Driver re-application/);
});

test("legacy verification remains explicitly separate from Phase 6 review", () => {
  const legacy = driverAdminSummary({ id: "driver-2", status: "pending", verification_status: "pending_review",
    online: false, busy: false }, "2026-10-08T00:00:00Z");
  assert.equal(legacy.application?.source, "legacy");
  assert.equal(legacy.application?.scope, "legacy_driver_verification");
  assert.equal(legacy.application?.state, "needs_review");
  assert.equal(legacy.presence.state, "offline");
});
