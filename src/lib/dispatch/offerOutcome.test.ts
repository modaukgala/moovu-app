import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types tests require explicit extensions.
import { offerOutcome } from "./offerOutcome.ts";

const now = Date.parse("2026-09-26T10:00:00Z");
const live = { status: "shown", accept_deadline_at: "2026-09-26T10:00:30Z" };
const available = { status: "offered", driver_id: null, offer_status: "pending" };
test("only a live assignable offer awaits response", () => {
  assert.equal(offerOutcome(live, available, "A", now), "pending");
  assert.equal(offerOutcome({ ...live, accept_deadline_at: new Date(now).toISOString() }, available, "A", now), "missed");
  assert.equal(offerOutcome({ ...live, accept_deadline_at: null }, available, "A", now), "cancelled");
  assert.equal(offerOutcome(live, null, "A", now), "cancelled");
});
test("authoritative winner replaces stale pending labels for both drivers", () => {
  const trip = { ...available, status: "assigned", driver_id: "B", offer_status: "accepted" };
  assert.equal(offerOutcome(live, trip, "A", now), "accepted_by_another");
  assert.equal(offerOutcome(live, trip, "B", now), "accepted_by_you");
  assert.equal(offerOutcome({ ...live, status: "cancelled" }, trip, "A", now), "accepted_by_another");
});
test("terminal trips never await response", () => {
  assert.equal(offerOutcome(live, { ...available, status: "cancelled" }, "A", now), "cancelled");
  assert.equal(offerOutcome(live, { ...available, status: "completed", driver_id: "B" }, "A", now), "accepted_by_another");
  assert.equal(offerOutcome(live, { ...available, status: "completed", driver_id: "A" }, "A", now), "accepted_by_you");
});
test("historical declines, expiry and acceptance are not rewritten by later assignment", () => {
  const trip = { ...available, status: "completed", driver_id: "B" };
  assert.equal(offerOutcome({ ...live, status: "declined" }, trip, "A", now), "declined");
  assert.equal(offerOutcome({ ...live, status: "expired" }, trip, "A", now), "missed");
  assert.equal(offerOutcome({ ...live, status: "accepted" }, trip, "A", now), "accepted_by_you");
});
