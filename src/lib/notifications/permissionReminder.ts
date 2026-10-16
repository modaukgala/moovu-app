export type ReminderPermission = "granted" | "prompt" | "denied" | "limited" | "unsupported";

export function classifyNotificationPermission(value: string | null, supported: boolean): ReminderPermission {
  if (!supported) return "unsupported";
  if (value === "granted") return "granted";
  if (value === "denied") return "denied";
  if (value === "provisional" || value === "limited") return "limited";
  return "prompt";
}

export function shouldShowNotificationReminder(permission: ReminderPermission, active: boolean, dismissed: boolean) {
  return active && !dismissed && permission !== "granted" && permission !== "unsupported";
}
