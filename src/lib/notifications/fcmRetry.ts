const TRANSIENT_CODES = new Set([
  "messaging/server-unavailable", "messaging/internal-error", "messaging/quota-exceeded",
  "messaging/message-rate-exceeded", "messaging/device-message-rate-exceeded",
]);

export function firebaseFailureCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code : "unknown";
}

export function firebaseRetryAfterMs(error: unknown, now = Date.now()) {
  if (typeof error !== "object" || error === null) return 0;
  const record = error as Record<string, unknown>;
  const response = record.httpResponse ?? record.response;
  if (typeof response !== "object" || response === null || !("headers" in response)) return 0;
  const headers = response.headers;
  if (typeof headers !== "object" || headers === null) return 0;
  const raw = headers instanceof Headers ? headers.get("retry-after") : (headers as Record<string, unknown>)["retry-after"];
  if (raw == null) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(String(raw));
  return Number.isFinite(date) ? Math.max(0, date - now) : Number.POSITIVE_INFINITY;
}

/** Retry explicit transient rejections only; ambiguous transport timeouts are not replayed here. */
export async function retryOfferPush<T>(send: () => Promise<T>, options: {
  expiresAtMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (code: string, attempt: number) => void;
  random?: () => number;
}): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    if (now() >= options.expiresAtMs) throw new Error("Trip offer expired before push submission.");
    try { return await send(); } catch (error) {
      const code = firebaseFailureCode(error);
      // Quota errors require a longer provider cooldown than this short offer window.
      if (!TRANSIENT_CODES.has(code) || code.includes("quota") || code.includes("rate-exceeded") || attempt >= 3) throw error;
      const delay = Math.max(firebaseRetryAfterMs(error, now()), 10000 * 2 ** (attempt - 1))
        + Math.floor((options.random ?? Math.random)() * 1000);
      if (now() + delay >= options.expiresAtMs) throw error;
      options.onRetry?.(code, attempt);
      await sleep(delay);
    }
  }
}
