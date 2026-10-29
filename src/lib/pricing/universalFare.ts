export const STANDARD_FARE_VERSION = "standard-final-fare-v1";
export const FUEL_FARE_VERSION = "standard-final-fare-fuel-230bp-whole-rand-v2";
export const FUEL_INCREASE_BASIS_POINTS = 230;

export function universalFareIncreaseEnabled(
  environment: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): boolean {
  if (environment.MOOVU_UNIVERSAL_FARE_23_ENABLED?.trim().toLowerCase() !== "true") return false;
  const cutoff = environment.MOOVU_FARE_EFFECTIVE_AT?.trim();
  if (!cutoff || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(cutoff)) return false;
  const parsed = new Date(cutoff);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === cutoff.slice(0, 19) &&
    now.getTime() >= parsed.getTime();
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
  const adjustedFareCents = baseFareCents + increaseCents;
  const rideFareCents = enabled
    ? Math.ceil(adjustedFareCents / 100) * 100
    : adjustedFareCents;
  return {
    version: enabled ? FUEL_FARE_VERSION : STANDARD_FARE_VERSION,
    baseFareCents,
    increaseCents: rideFareCents - baseFareCents,
    rideFareCents,
  };
}

export function fareQuoteMatches(
  pricedFare: ReturnType<typeof priceStandardFare>,
  expectedVersion: unknown,
  expectedRideFareCents: unknown,
): boolean {
  return expectedVersion === pricedFare.version && expectedRideFareCents === pricedFare.rideFareCents;
}
