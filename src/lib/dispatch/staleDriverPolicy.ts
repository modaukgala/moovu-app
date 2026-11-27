/** Minutes of no location after which an online driver is reminded. */
export const STALE_REMINDER_MINUTES = [30, 120] as const;
/** The job runs every 15 minutes, so each reminder point is a 15-minute slot. */
export const STALE_JOB_EVERY_MINUTES = 15;

/** Which reminder (if any) a driver is due, from how stale their location is. */
export function staleReminderDue(lastSeen: string | null, nowMs: number) {
  if (!lastSeen) return null;
  const minutes = (nowMs - new Date(lastSeen).getTime()) / 60_000;
  if (!Number.isFinite(minutes)) return null;
  for (const at of STALE_REMINDER_MINUTES) {
    if (minutes >= at && minutes < at + STALE_JOB_EVERY_MINUTES) return at;
  }
  return null;
}
