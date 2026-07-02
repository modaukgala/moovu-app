export const DRIVER_VERIFICATION_ACTIONS = [
  "pending_review",
  "approved",
  "needs_more_info",
  "rejected",
] as const;

export type DriverVerificationAction = (typeof DRIVER_VERIFICATION_ACTIONS)[number];
export type PersistedDriverVerificationStatus = "pending_review" | "approved" | "rejected";

export const DEFAULT_DRIVER_VERIFICATION_STATUS: PersistedDriverVerificationStatus = "pending_review";

export function isDriverVerificationAction(value: unknown): value is DriverVerificationAction {
  return DRIVER_VERIFICATION_ACTIONS.includes(value as DriverVerificationAction);
}

export function persistedDriverVerificationStatus(
  action: DriverVerificationAction,
): PersistedDriverVerificationStatus {
  return action === "needs_more_info" ? "pending_review" : action;
}
