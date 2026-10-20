export const PERFORMANCE_METRICS = [
  "driver_auth_restore",
  "driver_profile",
  "driver_offer_restore",
  "driver_trip_restore",
  "driver_dashboard_ready",
  "driver_earnings",
  "driver_map_ready",
  "driver_realtime_connect",
] as const;

export type PerformanceMetric = (typeof PERFORMANCE_METRICS)[number];

export function isPerformanceMetric(value: unknown): value is PerformanceMetric {
  return typeof value === "string" && PERFORMANCE_METRICS.some((metric) => metric === value);
}

export function parsePerformancePayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.sessionId)) return null;
  if (!isPerformanceMetric(data.metric)) return null;
  if (typeof data.durationMs !== "number" || !Number.isInteger(data.durationMs) || data.durationMs < 0 || data.durationMs > 60_000) return null;
  if (data.outcome !== "ok" && data.outcome !== "error" && data.outcome !== "timeout") return null;
  return { sessionId: data.sessionId, metric: data.metric, durationMs: data.durationMs, outcome: data.outcome };
}
