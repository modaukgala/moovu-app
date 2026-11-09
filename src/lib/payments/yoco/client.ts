import "server-only";
import { requestCheckout, type CheckoutInput, type CheckoutResult } from "./checkoutContract";
import { normalizeYocoMode } from "./mode";

export type CreateYocoCheckoutInput = CheckoutInput;
export type YocoCheckout = CheckoutResult;

export function getYocoCheckoutConfiguration() {
  const mode = normalizeYocoMode(process.env.YOCO_ENVIRONMENT);
  const secretKey = process.env.YOCO_SECRET_KEY?.trim();
  const baseUrl = process.env.YOCO_API_BASE_URL ?? "https://payments.yoco.com/api";
  if (!mode || !secretKey || !secretKey.startsWith(mode === "live" ? "sk_live_" : "sk_test_")
    || baseUrl.replace(/\/+$/, "") !== "https://payments.yoco.com/api") {
    throw new Error("Yoco checkout configuration unavailable.");
  }
  return { mode, secretKey, baseUrl };
}

export async function createYocoCheckout(input: CreateYocoCheckoutInput): Promise<YocoCheckout> {
  return requestCheckout(input, getYocoCheckoutConfiguration());
}
