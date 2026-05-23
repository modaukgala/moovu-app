import { getFareRules, normalizeRideOptionId, type RideOptionId } from "@/lib/domain/fare";

export const FREE_CANCELLATION_WINDOW_MS = 2 * 60 * 1000;
export const NO_SHOW_WAIT_MS = 5 * 60 * 1000;

export type CancellationFeeType = "free_cancel" | "late_cancel" | "no_show";

export type CancellationFee = {
  type: CancellationFeeType;
  feeAmount: number;
  driverAmount: number;
  moovuAmount: number;
  policyCode: string;
  rideOptionId: RideOptionId;
};

export const FREE_CANCELLATION_FEE: CancellationFee = {
  type: "free_cancel",
  feeAmount: 0,
  driverAmount: 0,
  moovuAmount: 0,
  policyCode: "free_cancel",
  rideOptionId: "go",
};

export const LATE_CANCELLATION_FEE: CancellationFee = {
  type: "late_cancel",
  feeAmount: 20,
  driverAmount: 13,
  moovuAmount: 7,
  policyCode: "late_cancel_driver_dispatched",
  rideOptionId: "go",
};

export const NO_SHOW_FEE: CancellationFee = {
  type: "no_show",
  feeAmount: 30,
  driverAmount: 22,
  moovuAmount: 8,
  policyCode: "customer_no_show",
  rideOptionId: "go",
};

export function freeCancellationUntil(createdAt: string | null | undefined) {
  const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(createdMs)) return null;
  return new Date(createdMs + FREE_CANCELLATION_WINDOW_MS).toISOString();
}

function freeCancellationFee(rideOptionId: RideOptionId): CancellationFee {
  return { ...FREE_CANCELLATION_FEE, rideOptionId };
}

export function getLateCancellationFee(rideOptionValue: unknown): CancellationFee {
  const rideOptionId = normalizeRideOptionId(rideOptionValue);
  const rules = getFareRules(rideOptionId);
  return {
    type: "late_cancel",
    feeAmount: rules.lateCancellationFee,
    driverAmount: rules.lateCancellationDriverAmount,
    moovuAmount: rules.lateCancellationMoovuAmount,
    policyCode: "late_cancel_driver_dispatched",
    rideOptionId,
  };
}

export function getNoShowFee(rideOptionValue: unknown): CancellationFee {
  const rideOptionId = normalizeRideOptionId(rideOptionValue);
  const rules = getFareRules(rideOptionId);
  return {
    type: "no_show",
    feeAmount: rules.noShowFee,
    driverAmount: rules.noShowDriverAmount,
    moovuAmount: rules.noShowMoovuAmount,
    policyCode: "customer_no_show",
    rideOptionId,
  };
}

export function calculateCustomerCancellationFee(params: {
  status: string;
  createdAt: string | null | undefined;
  rideOptionId?: unknown;
}) {
  const status = params.status;
  const rideOptionId = normalizeRideOptionId(params.rideOptionId);
  const createdMs = params.createdAt ? new Date(params.createdAt).getTime() : NaN;
  const insideFreeWindow =
    Number.isFinite(createdMs) && Date.now() - createdMs <= FREE_CANCELLATION_WINDOW_MS;

  if (insideFreeWindow || status === "requested" || status === "offered") {
    return freeCancellationFee(rideOptionId);
  }

  if (status === "assigned" || status === "arrived") {
    return getLateCancellationFee(rideOptionId);
  }

  return freeCancellationFee(rideOptionId);
}

export function noShowEligibleAt(arrivedAt: string | null | undefined) {
  const arrivedMs = arrivedAt ? new Date(arrivedAt).getTime() : NaN;
  if (!Number.isFinite(arrivedMs)) return null;
  return new Date(arrivedMs + NO_SHOW_WAIT_MS).toISOString();
}

export function isNoShowEligible(arrivedAt: string | null | undefined) {
  const eligibleAt = noShowEligibleAt(arrivedAt);
  return !!eligibleAt && Date.now() >= new Date(eligibleAt).getTime();
}
