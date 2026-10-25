export const STANDARD_FARE_VERSION = "standard-final-fare-v1";
export const FUEL_FARE_VERSION = "standard-final-fare-fuel-230bp-v1";
export const FUEL_INCREASE_BASIS_POINTS = 230;

export function universalFareIncreaseEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.MOOVU_UNIVERSAL_FARE_23_ENABLED?.trim().toLowerCase() === "true";
}

/** Applies the versioned change once, after the authoritative engine's minimum and rounding. */
export function priceStandardFare(engineFareRands: number, enabled: boolean) {
  const baseFareCents = Math.round(engineFareRands * 100);
  if (!Number.isFinite(engineFareRands) || !Number.isSafeInteger(baseFareCents) || baseFareCents <= 0) {
    throw new Error("The authoritative fare is invalid.");
  }
  if (baseFareCents > Math.floor((Number.MAX_SAFE_INTEGER - 5000) / FUEL_INCREASE_BASIS_POINTS)) {
    throw new Error("The authoritative fare exceeds the supported range.");
  }
  const increaseCents = enabled
    ? Math.floor((baseFareCents * FUEL_INCREASE_BASIS_POINTS + 5000) / 10000)
    : 0;
  return {
    version: enabled ? FUEL_FARE_VERSION : STANDARD_FARE_VERSION,
    baseFareCents,
    increaseCents,
    rideFareCents: baseFareCents + increaseCents,
  };
}

export function fareQuoteMatches(
  pricedFare: ReturnType<typeof priceStandardFare>,
  expectedVersion: unknown,
  expectedRideFareCents: unknown,
): boolean {
  return expectedVersion === pricedFare.version && expectedRideFareCents === pricedFare.rideFareCents;
}
