export type RideOptionId = "go" | "group";
export type SurgeLabel = "normal" | "busy" | "heavy_demand" | "rain_event";
export type SurgeMode = SurgeLabel;

export type SurgeModeConfig = {
  mode: SurgeMode;
  label: string;
  multiplier: number;
  message: string;
};

export type FareInput = {
  distanceKm: number;
  durationMin: number;
  rideOptionId?: RideOptionId | null;
  surgeLabel?: SurgeLabel | null;
  surgeMultiplier?: number | null;
  waitingMinutes?: number | null;
  remotePickupFee?: number | null;
};

export type AddStopInput = {
  rideOptionId?: RideOptionId | null;
  originalDistanceKm: number;
  originalDurationMin: number;
  routeDistanceKm: number;
  routeDurationMin: number;
  stopCount: number;
};

export type AddStopBreakdown = {
  stopCount: number;
  extraDistanceKm: number;
  extraDurationMin: number;
  perKm: number;
  perMinute: number;
  stopFee: number;
  rawAddStopIncrease: number;
  addStopDiscountPercent: number;
  finalAddStopIncrease: number;
};

export type StopWaitingFeeInput = {
  rideOptionId?: RideOptionId | null;
  stopWaitingMinutes: number[];
};

export type StopWaitingFeeBreakdown = {
  freeMinutesPerStop: number;
  maxMinutesPerStop: number;
  maxTotalMinutes: number;
  billableMinutes: number;
  waitingFeePerMinute: number;
  stopWaitingFee: number;
};

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
  bookingFee: number;
  minFare: number;
  waitingFeePerMinute: number;
  freeWaitingMinutes: number;
  platformCommissionPct: number;
  lateCancellationFee: number;
  lateCancellationDriverAmount: number;
  lateCancellationMoovuAmount: number;
  noShowFee: number;
  noShowDriverAmount: number;
  noShowMoovuAmount: number;
  remotePickupFeeMin: number;
  remotePickupFeeMax: number;
};

export type FareBreakdown = FareRules & {
  rideOptionId: RideOptionId;
  rideOptionName: string;
  distanceKm: number;
  durationMin: number;
  chargeableWaitingMinutes: number;
  waitingFee: number;
  remotePickupFee: number;
  longDistanceUpliftPct: number;
  longDistanceUpliftAmount: number;
  surgeLabel: SurgeLabel;
  surgeMultiplier: number;
  surgeAmount: number;
  rawFare: number;
  fareBeforeUplift: number;
  fareBeforeSurge: number;
  fareBeforeMinimum: number;
  fareBeforeRounding: number;
  totalFare: number;
  platformCommission: number;
  driverNetEstimate: number;
};

export const SURGE_MULTIPLIERS: Record<SurgeLabel, number> = {
  normal: 1,
  busy: 1.1,
  heavy_demand: 1.2,
  rain_event: 1.4,
};

export const SURGE_MODES: Record<SurgeMode, SurgeModeConfig> = {
  normal: {
    mode: "normal",
    label: "Normal",
    multiplier: 1,
    message: "Standard pricing",
  },
  busy: {
    mode: "busy",
    label: "Busy",
    multiplier: 1.1,
    message: "Busy area pricing included",
  },
  heavy_demand: {
    mode: "heavy_demand",
    label: "Heavy demand",
    multiplier: 1.2,
    message: "High demand pricing included",
  },
  rain_event: {
    mode: "rain_event",
    label: "Rain/Event",
    multiplier: 1.4,
    message: "Weather or event pricing included",
  },
};

export const DEFAULT_SURGE_MODE: SurgeMode = "normal";
export const MAX_SURGE_MULTIPLIER = 1.4;

export const RIDE_OPTION_RULES: Record<RideOptionId, FareRules> = {
  go: {
    baseFare: 15,
    perKm: 9,
    perMinute: 1.5,
    bookingFee: 4,
    minFare: 40,
    waitingFeePerMinute: 2,
    freeWaitingMinutes: 3,
    platformCommissionPct: 10,
    lateCancellationFee: 20,
    lateCancellationDriverAmount: 13,
    lateCancellationMoovuAmount: 7,
    noShowFee: 30,
    noShowDriverAmount: 22,
    noShowMoovuAmount: 8,
    remotePickupFeeMin: 5,
    remotePickupFeeMax: 10,
  },
  group: {
    baseFare: 25,
    perKm: 12,
    perMinute: 2,
    bookingFee: 5,
    minFare: 70,
    waitingFeePerMinute: 3,
    freeWaitingMinutes: 3,
    platformCommissionPct: 12,
    lateCancellationFee: 30,
    lateCancellationDriverAmount: 20,
    lateCancellationMoovuAmount: 10,
    noShowFee: 40,
    noShowDriverAmount: 30,
    noShowMoovuAmount: 10,
    remotePickupFeeMin: 5,
    remotePickupFeeMax: 15,
  },
};

export const RIDE_OPTIONS: readonly RideOption[] = [
  {
    id: "go",
    name: "MOOVU Go",
    capacity: "Up to 3 riders",
    description: "Everyday local rides",
    baseFare: RIDE_OPTION_RULES.go.minFare,
  },
  {
    id: "group",
    name: "MOOVU Go XL",
    capacity: "Up to 6 riders",
    description: "More space for groups",
    baseFare: RIDE_OPTION_RULES.group.minFare,
  },
] as const;

export const DEFAULT_RIDE_OPTION_ID: RideOptionId = "go";
export const DEFAULT_FARE_RULES: FareRules = RIDE_OPTION_RULES.go;
export const MAX_TRIP_STOPS = 2;
export const ADD_STOP_DISCOUNT_PERCENT = 40;
export const ADD_STOP_CUSTOMER_PAY_MULTIPLIER = 0.6;
export const STOP_WAITING_FREE_MINUTES = 3;
export const STOP_WAITING_MAX_MINUTES_PER_STOP = 10;
export const STOP_WAITING_MAX_TOTAL_MINUTES = 15;

export const ADD_STOP_FEES: Record<RideOptionId, number> = {
  go: 10,
  group: 15,
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function safePositiveNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeRideOptionId(value: unknown): RideOptionId {
  return value === "group" ? "group" : DEFAULT_RIDE_OPTION_ID;
}

export function getRideOption(value: unknown) {
  const rideOptionId = normalizeRideOptionId(value);
  return RIDE_OPTIONS.find((option) => option.id === rideOptionId) ?? RIDE_OPTIONS[0];
}

export function getFareRules(value: unknown): FareRules {
  return RIDE_OPTION_RULES[normalizeRideOptionId(value)];
}

export function getCommissionPctForRideOption(value: unknown) {
  return getFareRules(value).platformCommissionPct;
}

export function getLongDistanceUpliftPct(distanceKm: number) {
  if (distanceKm > 50) return 10;
  if (distanceKm >= 25) return 7.5;
  if (distanceKm >= 10) return 5;
  return 0;
}

export function validateSurgeMode(value: unknown): SurgeMode {
  return typeof value === "string" && value in SURGE_MODES
    ? (value as SurgeMode)
    : DEFAULT_SURGE_MODE;
}

export function getSurgeModeConfig(value: unknown): SurgeModeConfig {
  const mode = validateSurgeMode(value);
  return SURGE_MODES[mode];
}

export function normalizeSurge(params: {
  label?: SurgeLabel | null;
  multiplier?: number | null;
}) {
  const config = getSurgeModeConfig(params.label);
  const label = config.mode;
  const labelMultiplier = config.multiplier;
  const rawMultiplier = params.multiplier == null ? labelMultiplier : Number(params.multiplier);
  return {
    label,
    multiplier: roundMoney(clamp(Number.isFinite(rawMultiplier) ? rawMultiplier : 1, 1, MAX_SURGE_MULTIPLIER)),
  };
}

export function calculateTripFare(input: FareInput): FareBreakdown {
  const rideOptionId = normalizeRideOptionId(input.rideOptionId);
  const rideOption = getRideOption(rideOptionId);
  const rules = getFareRules(rideOptionId);
  const distanceKm = safePositiveNumber(input.distanceKm);
  const durationMin = safePositiveNumber(input.durationMin);
  const waitingMinutes = safePositiveNumber(input.waitingMinutes);
  const chargeableWaitingMinutes = Math.max(0, Math.ceil(waitingMinutes - rules.freeWaitingMinutes));
  const waitingFee = roundMoney(chargeableWaitingMinutes * rules.waitingFeePerMinute);
  const remotePickupFee = roundMoney(safePositiveNumber(input.remotePickupFee));
  const surge = normalizeSurge({
    label: input.surgeLabel,
    multiplier: input.surgeMultiplier,
  });

  const rawFare = roundMoney(
    rules.baseFare +
      distanceKm * rules.perKm +
      durationMin * rules.perMinute +
      rules.bookingFee +
      waitingFee +
      remotePickupFee
  );
  const longDistanceUpliftPct = getLongDistanceUpliftPct(distanceKm);
  const longDistanceUpliftAmount = roundMoney(rawFare * (longDistanceUpliftPct / 100));
  const fareBeforeUplift = rawFare;
  const fareBeforeSurge = roundMoney(fareBeforeUplift + longDistanceUpliftAmount);
  const surgeAmount = roundMoney(fareBeforeSurge * (surge.multiplier - 1));
  const fareBeforeMinimum = roundMoney(fareBeforeSurge * surge.multiplier);
  const fareBeforeRounding = Math.max(rules.minFare, fareBeforeMinimum);
  const totalFare = Math.round(fareBeforeRounding);
  const platformCommission = roundMoney(totalFare * (rules.platformCommissionPct / 100));
  const driverNetEstimate = roundMoney(totalFare - platformCommission);

  return {
    ...rules,
    rideOptionId,
    rideOptionName: rideOption.name,
    distanceKm,
    durationMin,
    chargeableWaitingMinutes,
    waitingFee,
    remotePickupFee,
    longDistanceUpliftPct,
    longDistanceUpliftAmount,
    surgeLabel: surge.label,
    surgeMultiplier: surge.multiplier,
    surgeAmount,
    rawFare,
    fareBeforeUplift,
    fareBeforeSurge,
    fareBeforeMinimum,
    fareBeforeRounding: roundMoney(fareBeforeRounding),
    totalFare,
    platformCommission,
    driverNetEstimate,
  };
}

export function calculateAddStopIncrease(input: AddStopInput): AddStopBreakdown {
  const rideOptionId = normalizeRideOptionId(input.rideOptionId);
  const rules = getFareRules(rideOptionId);
  const stopCount = Math.min(Math.max(0, Math.floor(Number(input.stopCount) || 0)), MAX_TRIP_STOPS);
  const originalDistanceKm = safePositiveNumber(input.originalDistanceKm);
  const originalDurationMin = safePositiveNumber(input.originalDurationMin);
  const routeDistanceKm = safePositiveNumber(input.routeDistanceKm);
  const routeDurationMin = safePositiveNumber(input.routeDurationMin);
  const extraDistanceKm = roundMoney(Math.max(0, routeDistanceKm - originalDistanceKm));
  const extraDurationMin = roundMoney(Math.max(0, routeDurationMin - originalDurationMin));
  const stopFee = ADD_STOP_FEES[rideOptionId];
  const rawAddStopIncrease = roundMoney(
    extraDistanceKm * rules.perKm +
      extraDurationMin * rules.perMinute +
      stopCount * stopFee
  );
  const finalAddStopIncrease = Math.round(rawAddStopIncrease * ADD_STOP_CUSTOMER_PAY_MULTIPLIER);

  return {
    stopCount,
    extraDistanceKm,
    extraDurationMin,
    perKm: rules.perKm,
    perMinute: rules.perMinute,
    stopFee,
    rawAddStopIncrease,
    addStopDiscountPercent: ADD_STOP_DISCOUNT_PERCENT,
    finalAddStopIncrease,
  };
}

export function calculateStopWaitingFee(input: StopWaitingFeeInput): StopWaitingFeeBreakdown {
  const rules = getFareRules(input.rideOptionId);
  const clampedStopMinutes = input.stopWaitingMinutes
    .slice(0, MAX_TRIP_STOPS)
    .map((value) => Math.min(safePositiveNumber(value), STOP_WAITING_MAX_MINUTES_PER_STOP));
  const totalMinutes = Math.min(
    STOP_WAITING_MAX_TOTAL_MINUTES,
    clampedStopMinutes.reduce((sum, minutes) => sum + minutes, 0)
  );
  let remainingAllowedMinutes = totalMinutes;
  let billableMinutes = 0;

  for (const minutes of clampedStopMinutes) {
    if (remainingAllowedMinutes <= 0) break;
    const allowedAtStop = Math.min(minutes, remainingAllowedMinutes);
    remainingAllowedMinutes -= allowedAtStop;
    billableMinutes += Math.max(0, Math.ceil(allowedAtStop - STOP_WAITING_FREE_MINUTES));
  }

  return {
    freeMinutesPerStop: STOP_WAITING_FREE_MINUTES,
    maxMinutesPerStop: STOP_WAITING_MAX_MINUTES_PER_STOP,
    maxTotalMinutes: STOP_WAITING_MAX_TOTAL_MINUTES,
    billableMinutes,
    waitingFeePerMinute: rules.waitingFeePerMinute,
    stopWaitingFee: roundMoney(billableMinutes * rules.waitingFeePerMinute),
  };
}
