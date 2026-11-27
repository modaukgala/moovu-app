// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { phase6MissingRequirements, type Phase6Draft } from "../drivers/phase6Policy.ts";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { requirementLabel } from "../drivers/applicationNudge.ts";

/** One language for every driver, whichever system they came through. */
export type DriverStage =
  | "active"          // approved and allowed to drive
  | "deactivated"     // approved before, switched off by admin
  | "review"          // application submitted, waiting for you
  | "corrections"     // sent back to the driver to fix something
  | "draft"           // started the application, not finished
  | "not_started"     // signed up, nothing filled in yet
  | "rejected"
  | "old_system";     // came through the old onboarding, no new application

export const STAGE_LABEL: Record<DriverStage, string> = {
  active: "Active",
  deactivated: "Deactivated",
  review: "Waiting for your review",
  corrections: "Fixing corrections",
  draft: "Application not finished",
  not_started: "Signed up, not started",
  rejected: "Rejected",
  old_system: "Old system",
};

const clean = (value: unknown) => String(value ?? "").trim();
const placeholder = (first: string, last: string) => !first || /^pending$/i.test(first) && (!last || /^driver$/i.test(last));

/** Real name: driver record, else what they typed in the application, else profile, else old application, else email. */
export function resolveDriverName(input: {
  first_name?: string | null; last_name?: string | null; email?: string | null;
  draft?: Phase6Draft | null; profile?: { first_name?: string | null; last_name?: string | null } | null;
  legacyFullName?: string | null;
}) {
  const first = clean(input.first_name);
  const last = clean(input.last_name);
  if (!placeholder(first, last)) return { name: `${first} ${last}`.trim(), fromRecord: true };
  const personal = input.draft?.personal ?? {};
  const draftName = `${clean(personal.first_name)} ${clean(personal.last_name)}`.trim();
  if (draftName) return { name: draftName, fromRecord: false };
  const profileName = `${clean(input.profile?.first_name)} ${clean(input.profile?.last_name)}`.trim();
  if (profileName) return { name: profileName, fromRecord: false };
  if (clean(input.legacyFullName)) return { name: clean(input.legacyFullName), fromRecord: false };
  const email = clean(input.email);
  return { name: email ? `No name yet (${email})` : "No name yet", fromRecord: false };
}

/** Missing application items in plain words. */
export function missingItems(draft: Phase6Draft | null | undefined) {
  if (!draft) return [] as string[];
  const missing = phase6MissingRequirements(draft);
  return Object.values(missing).flat().map(key => requirementLabel(String(key)));
}

export function draftIsEmpty(draft: Phase6Draft | null | undefined) {
  if (!draft) return true;
  return Object.values(draft).every(section => !section || Object.values(section).every(v =>
    v === null || v === undefined || String(typeof v === "object" ? JSON.stringify(v) : v).replace(/[{}"]/g, "").trim() === ""));
}

export function driverStage(input: {
  status: string | null; verification_status: string | null; applicationStatus: string | null; draft: Phase6Draft | null;
}): DriverStage {
  const app = input.applicationStatus;
  if (input.status === "inactive" && (input.verification_status === "approved" || app === "APPROVED")) return "deactivated";
  if (app === "APPROVED") return input.status === "inactive" ? "deactivated" : "active";
  if (app === "SUBMITTED" || app === "UNDER_REVIEW") return "review";
  if (app === "CORRECTION_REQUESTED") return "corrections";
  if (app === "REJECTED") return "rejected";
  if (app === "DRAFT") return draftIsEmpty(input.draft) ? "not_started" : "draft";
  if (input.status === "approved" || input.status === "active") return "active";
  if (input.status === "inactive") return "deactivated";
  return "old_system";
}
