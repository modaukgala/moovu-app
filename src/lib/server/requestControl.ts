type RateLimitState = {
  count: number;
  resetAt: number;
};

type CacheState<T> = {
  expiresAt: number;
  value: T;
};

type RequestControlStore = {
  rateLimits: Map<string, RateLimitState>;
  responseCache: Map<string, CacheState<unknown>>;
  inFlight: Map<string, Promise<unknown>>;
};

declare global {
  var __moovuRequestControlStore: RequestControlStore | undefined;
}

function store(): RequestControlStore {
  if (!globalThis.__moovuRequestControlStore) {
    globalThis.__moovuRequestControlStore = {
      rateLimits: new Map(),
      responseCache: new Map(),
      inFlight: new Map(),
    };
  }

  return globalThis.__moovuRequestControlStore;
}

function now() {
  return Date.now();
}

function cleanup() {
  const current = now();
  const state = store();

  for (const [key, value] of state.rateLimits) {
    if (value.resetAt <= current) state.rateLimits.delete(key);
  }

  for (const [key, value] of state.responseCache) {
    if (value.expiresAt <= current) state.responseCache.delete(key);
  }
}

export function clientRequestKey(req: Request, scope: string) {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const realIp = req.headers.get("x-real-ip")?.trim() ?? "";
  const connectIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  const agent = req.headers.get("user-agent")?.slice(0, 80) ?? "unknown-agent";
  const ip = forwardedFor || realIp || connectIp || "unknown-ip";
  return `${scope}:${ip}:${agent}`;
}

export function takeRateLimit(
  req: Request,
  scope: string,
  options: { limit: number; windowMs: number },
) {
  cleanup();
  const current = now();
  const key = clientRequestKey(req, scope);
  const state = store();
  const existing = state.rateLimits.get(key);

  if (!existing || existing.resetAt <= current) {
    state.rateLimits.set(key, {
      count: 1,
      resetAt: current + options.windowMs,
    });

    return {
      ok: true as const,
      remaining: Math.max(0, options.limit - 1),
      resetAt: current + options.windowMs,
    };
  }

  if (existing.count >= options.limit) {
    return {
      ok: false as const,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  return {
    ok: true as const,
    remaining: Math.max(0, options.limit - existing.count),
    resetAt: existing.resetAt,
  };
}

export async function resolveCachedJson<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<{ value: T; cacheStatus: "hit" | "miss" }> {
  cleanup();
  const current = now();
  const state = store();
  const cached = state.responseCache.get(key) as CacheState<T> | undefined;

  if (cached && cached.expiresAt > current) {
    return { value: cached.value, cacheStatus: "hit" };
  }

  const existing = state.inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    const value = await existing;
    return { value, cacheStatus: "hit" };
  }

  const promise = loader()
    .then((value) => {
      state.responseCache.set(key, {
        value,
        expiresAt: now() + ttlMs,
      });
      return value;
    })
    .finally(() => {
      state.inFlight.delete(key);
    });

  state.inFlight.set(key, promise);
  const value = await promise;
  return { value, cacheStatus: "miss" };
}
