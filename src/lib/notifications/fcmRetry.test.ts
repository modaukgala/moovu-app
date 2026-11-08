import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types uses explicit extensions.
import { retryOfferPush } from "./fcmRetry.ts";

for (const code of ["messaging/invalid-registration-token", "messaging/registration-token-not-registered", "messaging/invalid-argument", "messaging/mismatched-credential", "messaging/quota-exceeded", "messaging/device-message-rate-exceeded", "ETIMEDOUT"]) {
  test(`${code} is not blindly replayed`, async () => {
    let calls = 0;
    await assert.rejects(retryOfferPush(async () => { calls++; throw { code }; }, { expiresAtMs: 10000, now: () => 0 }));
    assert.equal(calls, 1);
  });
}
test("explicit transient failures retry with bounded exponential backoff", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await retryOfferPush(async () => {
    if (++calls < 3) throw { code: "messaging/server-unavailable" };
    return "FCM_ACCEPTED_NOT_DEVICE_DELIVERED";
  }, { expiresAtMs: 100000, now: () => 0, random: () => 0, sleep: async ms => { delays.push(ms); } });
  assert.equal(result, "FCM_ACCEPTED_NOT_DEVICE_DELIVERED");
  assert.deepEqual(delays, [10000, 20000]);
});
test("transient failures stop after three submissions", async () => {
  let calls = 0;
  await assert.rejects(retryOfferPush(async () => { calls++; throw { code: "messaging/internal-error" }; },
    { expiresAtMs: 100000, now: () => 0, sleep: async () => {} }));
  assert.equal(calls, 3);
});
test("expired offers never submit or retry", async () => {
  let calls = 0;
  await assert.rejects(retryOfferPush(async () => { calls++; }, { expiresAtMs: 10, now: () => 10 }));
  assert.equal(calls, 0);
  await assert.rejects(retryOfferPush(async () => { calls++; throw { code: "messaging/internal-error" }; },
    { expiresAtMs: 100, now: () => 0, sleep: async () => assert.fail("No time for retry") }));
  assert.equal(calls, 1);
});

test("provider Retry-After longer than offer lifetime prevents another submission", async () => {
  let calls = 0;
  await assert.rejects(retryOfferPush(async () => {
    calls++;
    throw { code: "messaging/server-unavailable", response: { headers: { "retry-after": "60" } } };
  }, { expiresAtMs: 25000, now: () => 0, sleep: async () => assert.fail("Provider delay exceeds offer lifetime") }));
  assert.equal(calls, 1);
});
