export type CheckoutInput = {
  amountCents: number; currency?: "ZAR"; idempotencyKey: string;
  successUrl: string; cancelUrl: string; failureUrl?: string;
  metadata?: Record<string, string>;
};
export type CheckoutResult = { id: string; redirectUrl: string; status: string };

// Injected transport permits offline tests; replies never confer financial authority.
export async function requestCheckout(input: CheckoutInput, config: {
  secretKey: string; mode: "test" | "live"; baseUrl: string;
}, transport: typeof fetch = fetch): Promise<CheckoutResult> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0
    || (input.currency ?? "ZAR") !== "ZAR" || !input.idempotencyKey.trim()
    || config.baseUrl.replace(/\/+$/, "") !== "https://payments.yoco.com/api"
    || !config.secretKey.startsWith(config.mode === "live" ? "sk_live_" : "sk_test_")) {
    throw new Error("Yoco checkout configuration or authority is invalid.");
  }
  let response: Response;
  let value: unknown;
  try {
    response = await transport("https://payments.yoco.com/api/checkouts", {
      method: "POST", headers: { Authorization: `Bearer ${config.secretKey}`,
        "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ amount: input.amountCents, currency: "ZAR",
        successUrl: input.successUrl, cancelUrl: input.cancelUrl,
        ...(input.failureUrl ? { failureUrl: input.failureUrl } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}) }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    });
    value = await response.json();
  } catch {
    throw new Error("Yoco checkout outcome unavailable; reconciliation is required before retry.");
  }
  if (!response.ok) throw new Error(`Yoco checkout rejected (HTTP ${response.status}).`);
  const data = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  if (!data || typeof data.id !== "string" || !data.id.trim()
    || typeof data.redirectUrl !== "string" || data.amount !== input.amountCents
    || data.currency !== "ZAR" || data.processingMode !== config.mode
    || !["created", "started", "processing", "completed"].includes(String(data.status))) {
    throw new Error("Yoco checkout response does not match payment authority.");
  }
  let redirect: URL;
  try { redirect = new URL(data.redirectUrl); } catch { throw new Error("Invalid Yoco checkout URL."); }
  if (redirect.origin !== "https://c.yoco.com" || redirect.username || redirect.password) {
    throw new Error("Unexpected Yoco checkout URL.");
  }
  return { id: data.id, redirectUrl: data.redirectUrl, status: String(data.status) };
}
