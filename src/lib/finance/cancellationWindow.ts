export const FREE_CANCELLATION_WINDOW_MS = 3 * 60 * 1000;

export function isWithinFreeCancellationWindow(
  createdAt: string | null | undefined,
  nowMs = Date.now(),
) {
  const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
  return Number.isFinite(createdMs) && nowMs - createdMs <= FREE_CANCELLATION_WINDOW_MS;
}
