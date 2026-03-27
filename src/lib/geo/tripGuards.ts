export const HEARTBEAT_MAX_AGE_MS = 90 * 1000;
export const ARRIVAL_RADIUS_KM = 0.35;
export const COMPLETION_RADIUS_KM = 0.8;

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function isFreshHeartbeat(lastSeen: string | null | undefined) {
  if (!lastSeen) return false;
  const ts = new Date(lastSeen).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= HEARTBEAT_MAX_AGE_MS;
}

export function minimumRequiredTripSeconds(durationMin: number | null | undefined) {
  const estMin = Number(durationMin || 0);

  if (!Number.isFinite(estMin) || estMin <= 0) {
    return 120;
  }

  const twentyPercent = Math.round(estMin * 60 * 0.2);
  return Math.max(120, Math.min(600, twentyPercent));
}