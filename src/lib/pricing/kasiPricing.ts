export function calculateKasiFare(distanceKm: number) {
  const BASE = 60;
  const FREE_KM = 3;
  const PER_KM = 10;

  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return BASE;

  if (distanceKm <= FREE_KM) return BASE;

  // Charge per started km above 3km
  const extraKm = Math.ceil(distanceKm - FREE_KM);
  return BASE + extraKm * PER_KM;
}