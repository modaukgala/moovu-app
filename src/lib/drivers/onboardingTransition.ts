// @ts-expect-error Node strip-types needs the explicit extension.
import { PHASE6_FIELDS, PHASE6_SECTIONS, type Phase6Draft } from "./phase6Policy.ts";

export function existingDriverDraft(driver: Record<string, unknown>, profile: Record<string, unknown>): Phase6Draft {
  const combined = { ...profile, ...Object.fromEntries(Object.entries(driver).filter(([, value]) => value !== null && value !== "")) };
  return Object.fromEntries(PHASE6_SECTIONS.map(section => [section, Object.fromEntries(PHASE6_FIELDS[section].filter(key => key !== "evidence" && combined[key] != null && combined[key] !== "").map(key => [key, String(combined[key])]))]));
}
export function mergeMissingDriverDetails(draft: Phase6Draft, existing: Phase6Draft): Phase6Draft {
  return Object.fromEntries(PHASE6_SECTIONS.map(section => [section, { ...existing[section], ...draft[section] }]));
}
export function reusableLegacyDocument(document: { status?: string | null; review_status?: string | null; expires_on?: string | null }, now = Date.now()) {
  const states = [document.status, document.review_status].filter(Boolean).map(value => String(value).toLowerCase());
  return states.length > 0 && states.every(value => ["approved", "verified"].includes(value)) && (!document.expires_on || Date.parse(document.expires_on + "T23:59:59Z") > now);
}

export function onboardingDriverName(draft: Phase6Draft, driver?: { first_name?: string | null; last_name?: string | null } | null): string {
  const personal = draft.personal ?? {};
  const first = String(personal.first_name ?? driver?.first_name ?? "").trim();
  const last = String(personal.last_name ?? driver?.last_name ?? "").trim();
  return [first, last].filter(Boolean).join(" ");
}
