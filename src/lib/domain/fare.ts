export type FareInput = {
  distanceKm: number;
  durationMin: number;
  rideOptionId?: RideOptionId | null;
};

export type RideOptionId = "go" | "group";

export type RideOption = {
  id: RideOptionId;
  name: string;
  capacity: string;
  description: string;
  baseFare: number;
};

export type FareRules = {
  baseFare: number;
  perKm: number;
  perMinute: number;
  minFare: number;
  platformCommissionPct: number;
};

export type FareBreakdown = FareRules & {
  distanceKm: number;
  durationMin: number;
  rawFare: number;
  fareBeforeRounding: number;
  totalFare: number;
  platformCommission: number;
  driverNetEstimate: number;
};

export const DEFAULT_FARE_RULES: FareRules = {
  baseFare: 40,
  perKm: 7,
  perMinute: 1.2,
  minFare: 40,
  platformCommissionPct: 5,
};

export const RIDE_OPTIONS: readonly RideOption[] = [
  {
    id: "go",
    name: "MOOVU Go",
    capacity: "Up to 3 riders",
    description: "Everyday local rides",
    baseFare: 40,
  },
  {
    id: "group",
    name: "MOOVU Group",
    capacity: "Up to 6 riders",
    description: "Larger vehicle request",
    baseFare: 75,
  },
] as const;

export const DEFAULT_RIDE_OPTION_ID: RideOptionId = "go";

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function safeNumber(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function normalizeRideOptionId(value: unknown): RideOptionId {
  return value === "group" ? "group" : DEFAULT_RIDE_OPTION_ID;
}

export function getRideOption(value: unknown) {
  const rideOptionId = normalizeRideOptionId(value);
  return RIDE_OPTIONS.find((option) => option.id === rideOptionId) ?? RIDE_OPTIONS[0];
}

export function calculateTripFare(
  input: FareInput,
  rules: FareRules = DEFAULT_FARE_RULES
): FareBreakdown {
  const distanceKm = safeNumber(Number(input.distanceKm));
  const durationMin = safeNumber(Number(input.durationMin));
  const rideOption = getRideOption(input.rideOptionId);
  const effectiveRules = {
    ...rules,
    baseFare: rideOption.baseFare,
    minFare: Math.max(rules.minFare, rideOption.baseFare),
  };

  const rawFare =
    effectiveRules.baseFare + distanceKm * effectiveRules.perKm + durationMin * effectiveRules.perMinute;
  const fareBeforeRounding = Math.max(effectiveRules.minFare, rawFare);
  const totalFare = Math.round(fareBeforeRounding);
  const platformCommission = roundMoney(totalFare * (effectiveRules.platformCommissionPct / 100));
  const driverNetEstimate = roundMoney(totalFare - platformCommission);

  return {
    ...effectiveRules,
    distanceKm,
    durationMin,
    rawFare: roundMoney(rawFare),
    fareBeforeRounding: roundMoney(fareBeforeRounding),
    totalFare,
    platformCommission,
    driverNetEstimate,
  };
}
