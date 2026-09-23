export const ONLINE_PAYMENT_STATES = [
  "CREATED",
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "RECONCILIATION_REQUIRED",
] as const;

export type OnlinePaymentState = (typeof ONLINE_PAYMENT_STATES)[number];

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function formatZarCents(cents: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(cents / 100);
}

export function shouldDispatchPaidTrip(input: {
  rideType: unknown;
  status: unknown;
  driverId: unknown;
  paymentState: unknown;
}): boolean {
  return input.paymentState === "SUCCEEDED" &&
    input.rideType === "now" &&
    input.driverId == null &&
    ["requested", "offered"].includes(String(input.status));
}

export function paymentResultPresentation(
  requested: "success" | "cancel" | "failure",
  state: string | null,
) {
  if (state === "SUCCEEDED") return { kind: "success" as const, title: "Payment confirmed" };
  if (state === "RECONCILIATION_REQUIRED") return { kind: "warning" as const, title: "Payment needs review" };
  if (requested === "success" && ["CREATED", "PENDING"].includes(state ?? "")) {
    return { kind: "pending" as const, title: "Confirming payment" };
  }
  if (requested === "cancel") return { kind: "neutral" as const, title: "Payment cancelled" };
  return { kind: "failure" as const, title: "Payment not completed" };
}
