import type { RideOptionId } from "@/lib/domain/fare";

export type DriverRideEligibility = {
  seatingCapacity: number | null;
  eligibleRideOptions: RideOptionId[];
  labels: string[];
  reviewRequired: boolean;
  reviewReason: string | null;
};

function normalizeSeats(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const seats = Number(value);
  return Number.isInteger(seats) && seats > 0 ? seats : null;
}

export function getDriverRideEligibility(value: unknown): DriverRideEligibility {
  const seatingCapacity = normalizeSeats(value);

  if (seatingCapacity === 7) {
    return {
      seatingCapacity,
      eligibleRideOptions: ["go", "group"],
      labels: ["MOOVU Go", "MOOVU Go Plus"],
      reviewRequired: false,
      reviewReason: null,
    };
  }

  const expectedGoCapacity =
    seatingCapacity !== null && seatingCapacity >= 3 && seatingCapacity <= 5;

  return {
    seatingCapacity,
    eligibleRideOptions: ["go"],
    labels: ["MOOVU Go"],
    reviewRequired: !expectedGoCapacity,
    reviewReason: expectedGoCapacity
      ? null
      : seatingCapacity === 6
        ? "Six-seat vehicles require admin review before MOOVU Go Plus eligibility."
        : "Seating capacity requires admin verification.",
  };
}

export function isDriverEligibleForRideOption(
  seatingCapacity: unknown,
  rideOption: unknown,
) {
  const normalizedRideOption: RideOptionId =
    String(rideOption ?? "go").toLowerCase() === "group" ? "group" : "go";
  return getDriverRideEligibility(seatingCapacity).eligibleRideOptions.includes(
    normalizedRideOption,
  );
}
