export const MATCHING_STEP_MS = 10_000;
export const MATCHING_WINDOW_MS = 90_000;

export function matchingRadiusKm(step: number, paid: boolean) {
  if (paid) return step < 3 ? 14 : 20;
  return step < 3 ? 8 : step < 6 ? 14 : 20;
}

export function matchingStep(startedAtMs: number, nowMs: number) {
  return Math.max(0, Math.floor((nowMs - startedAtMs) / MATCHING_STEP_MS));
}

export function nextMatchingStepAt(startedAtMs: number, nowMs: number) {
  const deadlineMs = startedAtMs + MATCHING_WINDOW_MS;
  return Math.min(deadlineMs, startedAtMs + (matchingStep(startedAtMs, nowMs) + 1) * MATCHING_STEP_MS);
}

export function isNinetySecondDispatchEnabledFor(createdAt: string | null | undefined,
  enabled = process.env.MOOVU_DISPATCH_90S_ENABLED,
  effectiveFrom = process.env.MOOVU_DISPATCH_90S_EFFECTIVE_FROM) {
  if (enabled !== "true") return false;
  const effectiveMs = Date.parse(effectiveFrom ?? "");
  const createdMs = Date.parse(createdAt ?? "");
  return Number.isFinite(effectiveMs) && Number.isFinite(createdMs) && createdMs >= effectiveMs;
}
