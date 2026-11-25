/** Pure rules for engagement reminders (kept separate so they can be unit-tested). */

export const ONBOARDING_REMINDER_GAP_DAYS = 3;
export const ONBOARDING_REMINDER_MAX = 4;
export const CUSTOMER_PROMO_MIN_DRIVERS = 3;

/** Africa/Johannesburg is UTC+2 all year (no DST). Only message people 08:00-18:59 local. */
export function withinFriendlyHours(now = new Date()) {
  const hour = (now.getUTCHours() + 2) % 24;
  return hour >= 8 && hour < 19;
}

/** Week bucket so customers get at most one "drivers online" push per week. */
export function weekKey(now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  const week = Math.floor((now.getTime() - start) / (7 * 24 * 3600 * 1000));
  return `${now.getUTCFullYear()}-w${week}`;
}

export function needsOnboardingReminder(status: string | null) {
  return status === null || status === "DRAFT" || status === "CORRECTION_REQUESTED";
}

/** Which reminder number (1-based) is due, or null. `sent` = timestamps of earlier reminders. */
export function dueOnboardingReminder(sent: number[], now = Date.now()) {
  if (sent.length >= ONBOARDING_REMINDER_MAX) return null;
  const last = sent.length ? Math.max(...sent) : 0;
  if (last && now - last < ONBOARDING_REMINDER_GAP_DAYS * 24 * 3600 * 1000) return null;
  return sent.length + 1;
}

export function onboardingReminderCopy(status: string | null) {
  if (status === null) return {
    title: "Complete your new MOOVU driver application",
    body: "It only takes a few minutes. Keep your driver account up to date. You can still go online meanwhile.",
  };
  if (status === "CORRECTION_REQUESTED") return {
    title: "Your MOOVU application needs a quick fix",
    body: "Open the app to see what to correct, then resubmit.",
  };
  return {
    title: "You're almost done with your MOOVU application",
    body: "Open the app to see what's left to upload and submit.",
  };
}
