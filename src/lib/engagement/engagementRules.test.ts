import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { dueOnboardingReminder, needsOnboardingReminder, withinFriendlyHours } from "./engagementRules.ts";

const DAY = 24 * 3600 * 1000;

test("reminders are spaced 3 days apart and capped at 4", () => {
  const now = Date.parse("2026-12-01T10:00:00Z");
  assert.equal(dueOnboardingReminder([], now), 1);
  assert.equal(dueOnboardingReminder([now - DAY], now), null);
  assert.equal(dueOnboardingReminder([now - 4 * DAY], now), 2);
  assert.equal(dueOnboardingReminder([1, 2, 3, 4], now), null);
});

test("only drafts, corrections and old-system drivers get reminders", () => {
  assert.equal(needsOnboardingReminder(null), true);
  assert.equal(needsOnboardingReminder("DRAFT"), true);
  assert.equal(needsOnboardingReminder("UNDER_REVIEW"), false);
  assert.equal(needsOnboardingReminder("APPROVED"), false);
});

test("messages only go out 08:00-19:00 South African time", () => {
  assert.equal(withinFriendlyHours(new Date("2026-12-01T05:59:00Z")), false);
  assert.equal(withinFriendlyHours(new Date("2026-12-01T06:00:00Z")), true);
  assert.equal(withinFriendlyHours(new Date("2026-12-01T17:00:00Z")), false);
});
