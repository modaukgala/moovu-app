import "server-only";

import { verifyYocoWebhookSignatureWithSecret, type YocoWebhookHeaders } from "@/lib/payments/yoco/webhookSignature";
export type { YocoWebhookHeaders } from "@/lib/payments/yoco/webhookSignature";

function getWebhookSecret(): string {
  const secret = process.env.YOCO_WEBHOOK_SECRET?.trim();

  if (!secret) {
    throw new Error("YOCO_WEBHOOK_SECRET is not configured.");
  }

  if (!secret.startsWith("whsec_")) {
    throw new Error("YOCO_WEBHOOK_SECRET has an invalid format.");
  }

  return secret;
}

export function verifyYocoWebhookSignature(params: {
  rawBody: string;
  headers: YocoWebhookHeaders;
  toleranceSeconds?: number;
}): boolean {
  return verifyYocoWebhookSignatureWithSecret({ ...params, webhookSecret: getWebhookSecret() });
}
