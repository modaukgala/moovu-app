type DriverCandidate = {
  id: string;
  lat: number | null;
  lng: number | null;
  online?: boolean | null;
  busy?: boolean | null;
  subscription_status?: string | null;
  quality?: {
    avg_rating?: number | null;
    quality_score?: number | null;
    acceptance_rate?: number | null;
  } | null;
  offerStats?: {
    offers_missed?: number | null;
  } | null;
};

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function scoreDriverForTrip(params: {
  pickupLat: number;
  pickupLng: number;
  driver: DriverCandidate;
}) {
  const { pickupLat, pickupLng, driver } = params;

  if (
    driver.lat == null ||
    driver.lng == null ||
    !driver.online ||
    driver.busy
  ) {
    return {
      score: -9999,
      distanceKm: 9999,
    };
  }

  const distanceKm = haversineKm(
    pickupLat,
    pickupLng,
    Number(driver.lat),
    Number(driver.lng)
  );

  const distanceScore = Math.max(0, 60 - distanceKm * 8);
  const subscriptionScore =
    driver.subscription_status === "active" ? 15 : -20;

  const ratingScore = Number(driver.quality?.avg_rating ?? 5) * 4;
  const qualityScore = Number(driver.quality?.quality_score ?? 100) * 0.2;
  const acceptanceScore = Number(driver.quality?.acceptance_rate ?? 100) * 0.1;
  const missedPenalty = Number(driver.offerStats?.offers_missed ?? 0) * -2;

  const score = round2(
    distanceScore +
      subscriptionScore +
      ratingScore +
      qualityScore +
      acceptanceScore +
      missedPenalty
  );

  return {
    score,
    distanceKm: round2(distanceKm),
  };
}