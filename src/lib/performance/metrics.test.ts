import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types requires explicit extensions.
import { parsePerformancePayload } from "./metrics.ts";

const base = { sessionId: "12345678-1234-4234-8234-123456789abc", metric: "driver_profile", durationMs: 123, outcome: "ok" };

test("accepts only bounded, allowlisted, anonymous performance fields", () => {
  assert.deepEqual(parsePerformancePayload(base), base);
  assert.equal(parsePerformancePayload({ ...base, metric: "/driver/123" }), null);
  assert.equal(parsePerformancePayload({ ...base, durationMs: 60_001 }), null);
  assert.equal(parsePerformancePayload({ ...base, sessionId: "user@example.com" }), null);
  assert.equal(parsePerformancePayload({ ...base, outcome: "secret" }), null);
});
