import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { resolveCachedJson, takeRateLimit } from "./requestControl.ts";

test("concurrent identical requests share one loader", async () => {
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return { ok: true };
  };
  const key = `test:inflight:${Date.now()}`;
  const [first, second] = await Promise.all([
    resolveCachedJson(key, 1_000, loader),
    resolveCachedJson(key, 1_000, loader),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first.value, second.value);
});

test("fresh cache entries avoid repeated provider work", async () => {
  let calls = 0;
  const key = `test:cache:${Date.now()}`;
  const loader = async () => ++calls;
  const first = await resolveCachedJson(key, 1_000, loader);
  const second = await resolveCachedJson(key, 1_000, loader);
  assert.equal(first.value, 1);
  assert.equal(second.value, 1);
  assert.equal(calls, 1);
  assert.equal(second.cacheStatus, "hit");
});

test("different route signatures do not collide", async () => {
  let calls = 0;
  const prefix = `test:route:${Date.now()}`;
  await resolveCachedJson(`${prefix}:a`, 1_000, async () => ++calls);
  await resolveCachedJson(`${prefix}:b`, 1_000, async () => ++calls);
  assert.equal(calls, 2);
});

test("endpoint bursts are blocked before provider work", () => {
  const req = new Request("https://moovurides.co.za/api/maps/distance", {
    headers: { "x-forwarded-for": `127.0.0.${Date.now() % 200}` },
  });
  const scope = `test-rate-${Date.now()}`;
  assert.equal(takeRateLimit(req, scope, { limit: 2, windowMs: 60_000 }).ok, true);
  assert.equal(takeRateLimit(req, scope, { limit: 2, windowMs: 60_000 }).ok, true);
  assert.equal(takeRateLimit(req, scope, { limit: 2, windowMs: 60_000 }).ok, false);
});
