export type FareInput = {
  distanceKm: number;
  durationMin: number;
};

export type FareResult = {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  totalFare: number;
};

const BASE_FARE = 25;
const PER_KM = 7;
const PER_MINUTE = 1.2;
const MIN_FARE = 40;

export function calculateFare(input: FareInput): FareResult {
  const distanceKm = Number(input.distanceKm || 0);
  const durationMin = Number(input.durationMin || 0);

  const distanceFare = distanceKm * PER_KM;
  const timeFare = durationMin * PER_MINUTE;

  let total = BASE_FARE + distanceFare + timeFare;

  if (total < MIN_FARE) {
    total = MIN_FARE;
  }

  return {
    baseFare: BASE_FARE,
    distanceFare,
    timeFare,
    totalFare: Math.round(total * 100) / 100,
  };
}