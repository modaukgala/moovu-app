export type OfferOutcome = "accepted_by_you" | "accepted_by_another" | "missed" | "declined" | "cancelled" | "pending";

type Offer = { status: string | null; accept_deadline_at: string | null };
type Trip = { status: string | null; driver_id: string | null; offer_status?: string | null };

export function offerOutcome(offer: Offer, trip: Trip | null, driverId: string, now = Date.now()): OfferOutcome {
  const status = String(offer.status ?? "").toLowerCase();
  const tripStatus = String(trip?.status ?? "").toLowerCase();
  // Preserve recorded responses even if the trip later changes or is cancelled.
  if (status === "accepted") return "accepted_by_you";
  if (["declined", "rejected"].includes(status)) return "declined";
  if (status === "expired") return "missed";
  const hasWinner = Boolean(trip?.driver_id) &&
    (["assigned", "arrived", "ongoing", "completed"].includes(tripStatus) || trip?.offer_status === "accepted");
  if (hasWinner) return trip?.driver_id === driverId ? "accepted_by_you" : "accepted_by_another";
  if (status === "cancelled" || !trip || !["requested", "offered"].includes(tripStatus)) return "cancelled";
  const deadline = Date.parse(offer.accept_deadline_at ?? "");
  if (["pending", "shown"].includes(status) && Number.isFinite(deadline) && deadline <= now) return "missed";
  if (["pending", "shown"].includes(status) && Number.isFinite(deadline) && deadline > now && !trip.driver_id) return "pending";
  return "cancelled";
}
