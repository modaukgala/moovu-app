import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types uses explicit extensions.
import { deviceFailure } from "./deviceDelivery.ts";

test("invalid devices are terminal without invalidating the persisted offer", () => {
  for (const code of ["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "web/404", "web/410"]) {
    assert.deepEqual(deviceFailure(code, 1), { state: "INVALID", code });
  }
});

test("only explicit transient failures retry with bounded attempts and backoff", () => {
  assert.equal(deviceFailure("messaging/server-unavailable", 1).retrySeconds, 10);
  assert.equal(deviceFailure("messaging/server-unavailable", 2).retrySeconds, 20);
  assert.equal(deviceFailure("messaging/server-unavailable", 1, 90).retrySeconds, 90);
  assert.equal(deviceFailure("messaging/quota-exceeded", 1).retrySeconds, 60);
  assert.equal(deviceFailure("web/429", 1).retrySeconds, 60);
  assert.equal(deviceFailure("messaging/server-unavailable", 5).state, "FAILED");
});

test("ambiguous network failures and configuration errors are not blindly retried", () => {
  for (const code of ["ETIMEDOUT", "ECONNRESET", "messaging/invalid-argument", "configuration-missing"]) {
    assert.equal(deviceFailure(code, 1).state, "FAILED");
  }
});
