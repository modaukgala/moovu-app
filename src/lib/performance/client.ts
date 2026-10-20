"use client";

import { isPerformanceMetric, type PerformanceMetric } from "./metrics";

const SAMPLE_RATE = 0.05;
const MAX_EVENTS = 8;
const telemetryEnabled = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_MOOVU_PERFORMANCE_TELEMETRY === "true";
const sessionId = telemetryEnabled && typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "";
const sampled = telemetryEnabled && Math.random() < SAMPLE_RATE;
let eventCount = 0;

export function recordPerformanceMetric(metric: PerformanceMetric, durationMs: number, outcome: "ok" | "error" | "timeout" = "ok") {
  if (!sampled || !sessionId || !isPerformanceMetric(metric) || !Number.isFinite(durationMs) || eventCount >= MAX_EVENTS) return;
  eventCount += 1;
  const body = JSON.stringify({ sessionId, metric, durationMs: Math.min(60_000, Math.max(0, Math.round(durationMs))), outcome });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/performance/client", new Blob([body], { type: "application/json" }));
  }
}
