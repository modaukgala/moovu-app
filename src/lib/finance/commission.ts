import { getCommissionPctForRideOption } from "@/lib/domain/fare";

export const MOOVU_COMMISSION_PCT = 9.5;
export const MOOVU_COMMISSION_RATE = MOOVU_COMMISSION_PCT / 100;
export const DRIVER_COMMISSION_LOCK_LIMIT = 100;

export function resolveCommissionPct(params?: {
  rideOptionId?: unknown;
  commissionPct?: number | null;
}) {
  if (params?.commissionPct != null && Number.isFinite(Number(params.commissionPct))) {
    return Number(params.commissionPct);
  }

  if (params?.rideOptionId != null) {
    return getCommissionPctForRideOption(params.rideOptionId);
  }

  return MOOVU_COMMISSION_PCT;
}

export function calculateCommission(fareAmount: number, commissionPct = MOOVU_COMMISSION_PCT) {
  const fare = Number(fareAmount || 0);
  const pct = Number(commissionPct || 0);

  if (!Number.isFinite(fare) || fare <= 0) {
    return {
      fareAmount: 0,
      commissionPct: pct,
      commissionAmount: 0,
      driverNet: 0,
    };
  }

  const commissionAmount = Math.round((fare * (pct / 100)) * 100) / 100;
  const driverNet = Math.round((fare - commissionAmount) * 100) / 100;

  return {
    fareAmount: fare,
    commissionPct: pct,
    commissionAmount,
    driverNet,
  };
}
