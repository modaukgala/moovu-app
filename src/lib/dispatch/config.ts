export const DISPATCH_CONFIG = {
  escalationSeconds: 6,
  acceptWindowSeconds: 15,
  cycleCooldownSeconds: 12,
  gpsFreshnessSeconds: 90,
  initialRadiusKm: 8,
  expandedRadiusKm: 20,
  maxSearchSeconds: 180,
  maxCycles: 3,
  maxCandidatesPerStep: 25,
} as const;

export function dispatchRadiusForCycle(cycle: number) {
  if (cycle <= 1) return DISPATCH_CONFIG.initialRadiusKm;
  const progress = Math.min(1, (cycle - 1) / Math.max(1, DISPATCH_CONFIG.maxCycles - 1));
  return Math.round(
    (DISPATCH_CONFIG.initialRadiusKm +
      (DISPATCH_CONFIG.expandedRadiusKm - DISPATCH_CONFIG.initialRadiusKm) * progress) *
      10,
  ) / 10;
}

