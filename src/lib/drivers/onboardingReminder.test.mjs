import assert from "node:assert/strict";
import test from "node:test";
import { onboardingReminder } from "./onboardingReminder.ts";

test("incomplete onboarding keeps the existing application action available", () => {
  for (const status of [null, "DRAFT"]) {
    const reminder = onboardingReminder(status);
    assert.equal(reminder?.title, "Complete your driver application");
    assert.equal(reminder?.action, "Continue application");
  }
});

test("submitted and review states do not appear complete", () => {
  for (const status of ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"]) {
    const reminder = onboardingReminder(status);
    assert.equal(reminder?.title, "Application under review");
    assert.equal(reminder?.action, "View application");
  }
});

test("corrections and rejection retain an appropriate route back to onboarding", () => {
  assert.equal(onboardingReminder("CORRECTION_REQUESTED")?.action, "Review corrections");
  assert.equal(onboardingReminder("REJECTED")?.action, "View application");
});

test("only an approved latest application hides the reminder", () => {
  assert.equal(onboardingReminder("APPROVED"), null);
  assert.notEqual(onboardingReminder("UNKNOWN"), null);
});
