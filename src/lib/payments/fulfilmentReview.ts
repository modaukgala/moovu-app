import type { OnlinePaymentReportRow } from "./onlineReport";

export type ReviewTrip = {
  id: string;
  status: string | null;
  driver_id: string | null;
  offer_status: string | null;
};

export type FulfilmentState = "no-trip" | "awaiting-driver" | "allocated" | "in-progress" | "completed" | "cancelled";

export function classifyVerifiedPayment(payment: OnlinePaymentReportRow, trip: ReviewTrip | null): FulfilmentState {
  if (payment.payer_type !== "customer") throw new Error("Only verified Customer trip payments can enter fulfilment review.");
  if (!payment.trip_id || !trip) return "no-trip";
  if (trip.status === "completed") return "completed";
  if (trip.status === "cancelled") return "cancelled";
  if (trip.status === "ongoing") return "in-progress";
  if ((trip.status === "assigned" || trip.status === "arrived") && trip.driver_id && trip.offer_status === "accepted") return "allocated";
  return "awaiting-driver";
}

export const FULFILMENT_LABELS: Record<FulfilmentState, string> = {
  "no-trip": "Paid - no trip linked",
  "awaiting-driver": "Paid - awaiting driver",
  allocated: "Paid - driver allocated",
  "in-progress": "Paid - trip in progress",
  completed: "Paid - trip completed",
  cancelled: "Paid - trip cancelled",
};
