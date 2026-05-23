import { calculateTripFare, type RideOptionId } from "@/lib/domain/fare";
import type { SurgeLabel } from "@/lib/domain/fare";

type CalculateFareParams = {
  distanceKm?: number | null;
  durationMin?: number | null;
  rideOptionId?: RideOptionId | null;
  surgeLabel?: SurgeLabel | null;
  surgeMultiplier?: number | null;
  waitingMinutes?: number | null;
  remotePickupFee?: number | null;
};

export function calculateFare(params: CalculateFareParams) {
  return calculateTripFare({
    distanceKm: Number(params.distanceKm ?? 0),
    durationMin: Number(params.durationMin ?? 0),
    rideOptionId: params.rideOptionId,
    surgeLabel: params.surgeLabel,
    surgeMultiplier: params.surgeMultiplier,
    waitingMinutes: params.waitingMinutes,
    remotePickupFee: params.remotePickupFee,
  });
}
