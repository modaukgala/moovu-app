import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TOLERANCE_SECONDS = 3 * 60;

export type YocoWebhookHeaders = {
  webhookId: string;
  webhookTimestamp: string;
  webhookSignature: string;
};

function constantTimeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function getV1Signatures(signatureHeader: string): string[] {
  return signatureHeader.trim().split(/\s+/).map((entry) => {
    const commaIndex = entry.indexOf(",");
    return commaIndex > 0 && entry.slice(0, commaIndex) === "v1" ? entry.slice(commaIndex + 1) : null;
  }).filter((value): value is string => Boolean(value));
}

export function verifyYocoWebhookSignatureWithSecret(params: {
  rawBody: string;
  headers: YocoWebhookHeaders;
  webhookSecret: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean {
  const timestamp = Number(params.headers.webhookTimestamp);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return false;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (params.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)) return false;
  if (!params.webhookSecret.startsWith("whsec_")) return false;
  const encodedSecret = params.webhookSecret.slice("whsec_".length);
  const secretBytes = Buffer.from(encodedSecret, "base64");
  if (secretBytes.length === 0 || secretBytes.toString("base64").replace(/=+$/, "") !== encodedSecret.replace(/=+$/, "")) return false;
  const signedContent = `${params.headers.webhookId}.${params.headers.webhookTimestamp}.${params.rawBody}`;
  const expected = createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  return getV1Signatures(params.headers.webhookSignature).some((value) => constantTimeEqual(expected, value));
}
