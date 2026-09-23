export const ADMIN_TRIP_PAYMENT_METHODS = ["cash", "other"] as const;

export type AdminTripPaymentMethod = (typeof ADMIN_TRIP_PAYMENT_METHODS)[number];

export function isAdminTripPaymentMethod(value: string): value is AdminTripPaymentMethod {
  return ADMIN_TRIP_PAYMENT_METHODS.some((method) => method === value);
}
