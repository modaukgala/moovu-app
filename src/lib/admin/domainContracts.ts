// Read contracts only. These never calculate or post financial authority.
export type AdminSourceValue<T, Source extends string = string> = {
  value: T;
  source: Source;
  asOf: string;
  scope: string;
};

export type MoneyCents = { cents: number; currency: "ZAR" };

export type AdminFinanceContract = {
  tripFare: AdminSourceValue<MoneyCents, "trips.fare_amount" | "trips.final_fare"> | null;
  commissionAmount: AdminSourceValue<MoneyCents, "trip_commission_snapshot" | "financial_ledger"> | null;
  commissionOutstanding: AdminSourceValue<MoneyCents, "authoritative_financial_position"> | null;
  paymentVerification: AdminSourceValue<"pending" | "verified" | "rejected", "driver_payment_requests" | "online_provider_events"> | null;
  postedPayment: AdminSourceValue<MoneyCents, "financial_transactions"> | null;
  driverEarnings: AdminSourceValue<MoneyCents, "trip_estimate" | "financial_ledger"> | null;
  driverPayable: AdminSourceValue<MoneyCents, "online_driver_payables"> | null;
  settlement: AdminSourceValue<"pending" | "recorded" | "failed", "driver_settlements"> | null;
  payout: AdminSourceValue<"pending" | "approved" | "paid" | "failed" | "reversed", "provider_bound_payout_authority"> | null;
  subscriptionHistory: AdminSourceValue<"historical", "driver_subscription_events"> | null;
};

export type TripLifecycle = "requested" | "offered" | "assigned" | "arrived" | "ongoing" | "completed" | "cancelled";
export type OfferLifecycle = "pending" | "shown" | "accepted" | "declined" | "expired" | "cancelled";
export type AdminOperationsContract = {
  trip: AdminSourceValue<{ id: string; status: TripLifecycle }, "trips.status">;
  dispatch: AdminSourceValue<{ offerStatus: OfferLifecycle | null; assignedDriverId: string | null }, "driver_trip_offers" | "trips.driver_id">;
  customerIdentity: AdminSourceValue<{ customerId: string | null }, "trips.customer_id" | "customers.id">;
  receiptStatus: AdminSourceValue<"unavailable" | "available", "completed_trip_receipt">;
  notificationDelivery: AdminSourceValue<"queued" | "processing" | "delivered" | "failed" | "held", "moovu_notification_outbox" | "app_notifications">;
};
