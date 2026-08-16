import { createHmac, timingSafeEqual } from "node:crypto";
import type { DrivingRouteResult } from "@/lib/maps/routeService";

export type RouteQuote = Pick<
  DrivingRouteResult,
  | "routeSignature"
  | "distanceKm"
  | "durationMin"
  | "originalDistanceKm"
  | "originalDurationMin"
> & {
  expiresAt: number;
};

function quoteSecret(override?: string) {
  return override
    || process.env.MAPS_ROUTE_QUOTE_SECRET
    || process.env.DISPATCH_JOB_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || "";
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createRouteQuote(
  route: DrivingRouteResult,
  options?: { secret?: string; now?: number; ttlMs?: number },
) {
  const secret = quoteSecret(options?.secret);
  if (!secret) throw new Error("Route quote signing is not configured.");
  const quote: RouteQuote = {
    routeSignature: route.routeSignature,
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
    originalDistanceKm: route.originalDistanceKm,
    originalDurationMin: route.originalDurationMin,
    expiresAt: (options?.now ?? Date.now()) + (options?.ttlMs ?? 5 * 60_000),
  };
  const payload = Buffer.from(JSON.stringify(quote)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyRouteQuote(
  token: unknown,
  expectedRouteSignature: string,
  options?: { secret?: string; now?: number },
): RouteQuote | null {
  const secret = quoteSecret(options?.secret);
  const [payload, suppliedSignature] = String(token ?? "").split(".");
  if (!secret || !payload || !suppliedSignature) return null;
  const expectedSignature = signature(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<RouteQuote>;
    const metrics = [
      value.distanceKm,
      value.durationMin,
      value.originalDistanceKm,
      value.originalDurationMin,
      value.expiresAt,
    ];
    if (
      value.routeSignature !== expectedRouteSignature
      || !metrics.every((metric) => typeof metric === "number" && Number.isFinite(metric))
      || Number(value.expiresAt) <= (options?.now ?? Date.now())
      || Number(value.distanceKm) <= 0
      || Number(value.durationMin) <= 0
    ) {
      return null;
    }
    return value as RouteQuote;
  } catch {
    return null;
  }
}
