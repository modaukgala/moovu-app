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

function nonNegativeMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
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

/** Adds only the newly introduced stop charge to the current locked trip fare. */
export function addIncrementalStopCharge(params: {
  currentFare: unknown;
  previousStopIncrease: unknown;
  nextStopIncrease: unknown;
}) {
  const currentFare = validFare(params.currentFare);
  if (currentFare == null) return null;

  const previousStopIncrease = nonNegativeMoney(params.previousStopIncrease);
  const nextStopIncrease = nonNegativeMoney(params.nextStopIncrease);
  const addedStopCharge = Math.round(
    Math.max(0, nextStopIncrease - previousStopIncrease) * 100,
  ) / 100;

  return {
    currentFare: Math.round(currentFare * 100) / 100,
    previousStopIncrease,
    nextStopIncrease,
    addedStopCharge,
    finalFare: Math.round((currentFare + addedStopCharge) * 100) / 100,
  };
}
