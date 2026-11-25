export const MANAGEMENT_PAGE_SIZE = 25;

export const activitySources = {
  onboarding: { label: "Onboarding decisions", evidence: "Recorded submitted-version decisions", restricted: true },
  linking: { label: "Account linking", evidence: "Replay-keyed events. Repeated actions can share a record.", restricted: false },
  proofs: { label: "Payment proof decisions", evidence: "Latest reviewed state per proof. Approval is not external receipt verification.", restricted: true },
  settlements: { label: "Commission settlements", evidence: "Recorded collections", restricted: true },
  memberships: { label: "Membership payment decisions", evidence: "Latest reviewed payment state. Entitlement is separate.", restricted: true },
  cancellations: { label: "Cancellation finance actions", evidence: "Recorded assessment actions. Assessment and collection are separate.", restricted: true },
} as const;

export type ActivitySource = keyof typeof activitySources;
export type ManagementActivity = {
  id: string; actor: string | null; at: string | null; action: string;
  entity: string | null; detail: string | null; href: string | null;
};

export function recordedText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

export function recordedNumber(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function destination(path: string, id: unknown, parameter = "") {
  const value = recordedText(id);
  return value ? path + parameter + encodeURIComponent(value) : null;
}
