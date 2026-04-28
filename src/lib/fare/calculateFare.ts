import { calculateTripFare, type RideOptionId } from "@/lib/domain/fare";

type CalculateFareParams = {
  distanceKm?: number | null;
  durationMin?: number | null;
  rideOptionId?: RideOptionId | null;
};

export function calculateFare(params: CalculateFareParams) {
  return calculateTripFare({
    distanceKm: Number(params.distanceKm ?? 0),
    durationMin: Number(params.durationMin ?? 0),
    rideOptionId: params.rideOptionId,
  });
}
