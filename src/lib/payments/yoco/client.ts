import "server-only";
import { requestCheckout, type CheckoutInput, type CheckoutResult } from "./checkoutContract";
import { normalizeYocoMode } from "./mode";

export type CreateYocoCheckoutInput = CheckoutInput;
export type YocoCheckout = CheckoutResult;

export async function createYocoCheckout(input: CreateYocoCheckoutInput): Promise<YocoCheckout> {
  const mode = normalizeYocoMode(process.env.YOCO_ENVIRONMENT);
  const secretKey = process.env.YOCO_SECRET_KEY?.trim();
  if (!mode || !secretKey) throw new Error("Yoco checkout configuration unavailable.");
  return requestCheckout(input, { mode, secretKey,
    baseUrl: process.env.YOCO_API_BASE_URL ?? "https://payments.yoco.com/api" });
}
