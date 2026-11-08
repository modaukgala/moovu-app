export type DeviceDeliveryResult = {
  state: "ACCEPTED" | "INVALID" | "UNAVAILABLE" | "PENDING" | "FAILED" | "CANCELLED";
  code?: string;
  retrySeconds?: number;
};
export type OfferDeviceJob = {
  id: string; offer_id: string; user_id: string; transport: "fcm" | "web";
  device_ref: string; expires_at: string; attempts: number; lease_token: string;
};

export function deviceFailure(code: string, attempt: number, retryAfterSeconds = 0): DeviceDeliveryResult {
  if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "web/404", "web/410"].includes(code)) {
    return { state: "INVALID", code };
  }
  const transient = ["messaging/server-unavailable", "messaging/internal-error", "messaging/quota-exceeded",
    "messaging/message-rate-exceeded", "messaging/device-message-rate-exceeded", "web/429", "web/500", "web/502", "web/503", "web/504"];
  if (!transient.includes(code) || attempt >= 5) return { state: "FAILED", code };
  const minimum = code.includes("quota") || code.includes("rate-exceeded") || code === "web/429" ? 60 : 10;
  return { state: "PENDING", code, retrySeconds: Math.max(minimum, retryAfterSeconds, 10 * 2 ** Math.max(0, attempt - 1)) };
}
