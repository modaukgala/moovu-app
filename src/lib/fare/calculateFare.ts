type CalculateFareParams = {
  distanceKm?: number | null;
  durationMin?: number | null;
};

export function calculateFare(params: CalculateFareParams) {
  const distanceKm = Number(params.distanceKm ?? 0);
  const durationMin = Number(params.durationMin ?? 0);

  const baseFare = 25;
  const perKm = 7;
  const perMinute = 1.2;
  const minFare = 40;

  const rawFare = baseFare + distanceKm * perKm + durationMin * perMinute;
  const fareBeforeRounding = Math.max(minFare, rawFare);

  const totalFare = Math.round(fareBeforeRounding);

  return {
    baseFare,
    perKm,
    perMinute,
    minFare,
    distanceKm,
    durationMin,
    rawFare: Math.round(rawFare * 100) / 100,
    fareBeforeRounding: Math.round(fareBeforeRounding * 100) / 100,
    totalFare,
  };
}