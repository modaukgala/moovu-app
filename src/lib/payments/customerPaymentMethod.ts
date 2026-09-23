export type CustomerPaymentMethod = "cash" | "online";

export function normalizeCustomerPaymentMethod(value: unknown): CustomerPaymentMethod | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "cash" || normalized === "online" ? normalized : null;
}
