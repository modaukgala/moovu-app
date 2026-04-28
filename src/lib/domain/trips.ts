export const TRIP_STATUSES = [
  "requested",
  "scheduled",
  "offered",
  "assigned",
  "on_the_way",
  "arrived",
  "ongoing",
  "completed",
  "cancelled",
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

export const TRIP_OFFER_STATUSES = ["pending", "accepted", "rejected", "expired", "cancelled"] as const;

export type TripOfferStatus = (typeof TRIP_OFFER_STATUSES)[number];

export const PAYMENT_REVIEW_STATUSES = [
  "pending_payment_review",
  "waiting_confirmation",
  "approved",
  "rejected",
] as const;

export type PaymentReviewStatus = (typeof PAYMENT_REVIEW_STATUSES)[number];

export const DRIVER_SUBSCRIPTION_PLANS = {
  daily: { label: "Daily", amount: 45, durationDays: 1 },
  weekly: { label: "Weekly", amount: 100, durationDays: 7 },
  monthly: { label: "Monthly", amount: 250, durationDays: 30 },
} as const;

export type DriverSubscriptionPlan = keyof typeof DRIVER_SUBSCRIPTION_PLANS;

export function generateTripOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

