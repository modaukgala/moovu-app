import type { FinalFareBreakdown } from "@/lib/domain/fare";

type LockedFareSource = {
  finalFare?: unknown;
  fareAmount?: unknown;
  estimatedFare?: unknown;
  originalFare?: unknown;
  legacyFallbackFare?: unknown;
};

function validFare(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Returns the immutable customer-confirmed fare without considering live telemetry. */
export function resolveLockedTripFare(source: LockedFareSource) {
  const candidates = [
    source.finalFare,
    source.fareAmount,
    source.estimatedFare,
    source.originalFare,
    source.legacyFallbackFare,
  ];

  for (const candidate of candidates) {
    const fare = validFare(candidate);
    if (fare != null) return Math.round(fare * 100) / 100;
  }

  return null;
}

export function buildLockedFareBreakdown(source: LockedFareSource): FinalFareBreakdown | null {
  const lockedFare = resolveLockedTripFare(source);
  if (lockedFare == null) return null;

  return {
    estimatedFare: lockedFare,
    originalFare: lockedFare,
    addStopIncrease: 0,
    stopWaitingFee: 0,
    finalFare: lockedFare,
    adjustmentAmount: 0,
  };
}
