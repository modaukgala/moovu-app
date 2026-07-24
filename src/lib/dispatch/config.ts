export const DISPATCH_CONFIG = {
  escalationSeconds: 30,
  acceptWindowSeconds: 30,
  cycleCooldownSeconds: 0,
  gpsFreshnessSeconds: 90,
  backgroundOfferEligibilitySeconds: 8 * 60 * 60,
  initialRadiusKm: 8,
  expandedRadiusKm: 20,
  maxSearchSeconds: 5 * 60,
  maxCycles: 10,
  maxCandidatesPerStep: 25,
} as const;

export function isDispatchExpired(requestedAt: string | null | undefined, nowMs = Date.now()) {
  const requestedAtMs = requestedAt ? new Date(requestedAt).getTime() : Number.NaN;
  if (!Number.isFinite(requestedAtMs)) return false;
  return nowMs - requestedAtMs >= DISPATCH_CONFIG.maxSearchSeconds * 1000;
}

export function dispatchRadiusForCycle(cycle: number) {
  if (cycle <= 1) return DISPATCH_CONFIG.initialRadiusKm;
  const progress = Math.min(1, (cycle - 1) / Math.max(1, DISPATCH_CONFIG.maxCycles - 1));
  return Math.round(
    (DISPATCH_CONFIG.initialRadiusKm +
      (DISPATCH_CONFIG.expandedRadiusKm - DISPATCH_CONFIG.initialRadiusKm) * progress) *
      10,
  ) / 10;
}
