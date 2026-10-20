#!/usr/bin/env node
// Read-only synthetic load harness. It intentionally refuses non-local targets.
import { readFile } from "node:fs/promises";

const args = new Map(process.argv.slice(2).map((entry) => {
  const index = entry.indexOf("=");
  return [entry.slice(0, index), entry.slice(index + 1)];
}));
const base = args.get("--base");
const fixture = args.get("--fixture");
if (!base || !fixture) throw new Error("Usage: --base=http://127.0.0.1:3000 --fixture=<synthetic sessions JSON>");
const url = new URL(base);
if (!(["localhost", "127.0.0.1", "::1"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol))) {
  throw new Error("Load tests are restricted to an isolated localhost target.");
}
const { sessions } = JSON.parse(await readFile(fixture, "utf8"));
if (!Array.isArray(sessions) || sessions.length < 100 || sessions.some((session) =>
  !["customer", "driver", "admin"].includes(session.role) ||
  (typeof session.token !== "string" && typeof session.cookie !== "string")
)) throw new Error("Fixture must contain at least 100 synthetic sessions with role and test credentials.");

const paths = {
  customer: ["/", "/book", "/ride/history"],
  driver: ["/driver", "/api/driver/me", "/api/driver/current-trip", "/api/driver/offers/current"],
  admin: ["/admin", "/admin/trips"],
};
const levels = [10, 25, 50, 100];
const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;

for (const count of levels) {
  const latencies = [];
  let failures = 0;
  let requests = 0;
  const started = performance.now();
  await Promise.all(sessions.slice(0, count).map(async (session, index) => {
    await new Promise((resolve) => setTimeout(resolve, index * 100));
    for (const path of paths[session.role]) {
      requests += 1;
      const requestStarted = performance.now();
      try {
        const response = await fetch(new URL(path, url), {
          headers: {
            ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
            ...(session.cookie ? { Cookie: session.cookie } : {}),
          },
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
          redirect: "manual",
        });
        latencies.push(Math.round(performance.now() - requestStarted));
        if (!response.ok) failures += 1;
      } catch { failures += 1; }
    }
  }));
  latencies.sort((a, b) => a - b);
  const elapsed = Math.round(performance.now() - started);
  const result = { sessions: count, requests, failures, errorRate: Number((failures / Math.max(1, requests)).toFixed(3)), p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), p99: percentile(latencies, 0.99), elapsedMs: elapsed };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.errorRate > 0.02 || (result.p95 !== null && result.p95 > 3000)) {
    process.stderr.write("Stopping: error rate or p95 threshold exceeded.\n");
    process.exitCode = 1;
    break;
  }
}
