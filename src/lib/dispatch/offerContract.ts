export const DRIVER_OFFER_STATUSES = ["pending", "shown", "accepted", "declined", "expired", "cancelled"] as const;
export type DriverOfferStatus = (typeof DRIVER_OFFER_STATUSES)[number];
export const ACTIVE_DRIVER_OFFER_STATUSES: readonly DriverOfferStatus[] = ["pending", "shown"];
export const TERMINAL_DRIVER_OFFER_STATUSES: readonly DriverOfferStatus[] = ["accepted", "declined", "expired", "cancelled"];

export function isDriverOfferStatus(value: unknown): value is DriverOfferStatus {
  return typeof value === "string" && (DRIVER_OFFER_STATUSES as readonly string[]).includes(value);
}
