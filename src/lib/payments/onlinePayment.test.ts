import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { paymentResultPresentation, shouldDispatchPaidTrip } from "./onlinePayment.ts";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { verifyYocoWebhookSignatureWithSecret } from "./yoco/webhookSignature.ts";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { yocoEventModeMatches } from "./yoco/mode.ts";

test("browser success redirect remains pending until trusted state succeeds", () => {
  assert.equal(paymentResultPresentation("success", "PENDING").kind, "pending");
  assert.equal(paymentResultPresentation("success", "PENDING").title, "Confirming your payment...");
  assert.equal(paymentResultPresentation("success", "SUCCEEDED").kind, "success");
  assert.equal(paymentResultPresentation("success", "SUCCEEDED").title, "Payment received");
  assert.notEqual(paymentResultPresentation("success", "FAILED").kind, "success");
});

test("only paid immediate unassigned trips enter dispatch", () => {
  assert.equal(shouldDispatchPaidTrip({ rideType: "now", status: "requested", driverId: null, paymentState: "SUCCEEDED" }), true);
  assert.equal(shouldDispatchPaidTrip({ rideType: "scheduled", status: "scheduled", driverId: null, paymentState: "SUCCEEDED" }), false);
  assert.equal(shouldDispatchPaidTrip({ rideType: "now", status: "requested", driverId: null, paymentState: "PENDING" }), false);
  assert.equal(shouldDispatchPaidTrip({ rideType: "now", status: "cancelled", driverId: null, paymentState: "SUCCEEDED" }), false);
  assert.equal(shouldDispatchPaidTrip({ rideType: "now", status: "assigned", driverId: "driver", paymentState: "SUCCEEDED" }), false);
});

test("Yoco signature accepts a valid v1 among rotations and rejects tampering and expiry", () => {
  const secretBytes = Buffer.from("phase3-test-webhook-secret");
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const now = 2_000_000_000;
  const rawBody = JSON.stringify({ id: "evt_test", type: "payment.succeeded" });
  const webhookId = "msg_test";
  const timestamp = String(now);
  const valid = createHmac("sha256", secretBytes).update(`${webhookId}.${timestamp}.${rawBody}`).digest("base64");
  const base = { rawBody, webhookSecret: secret, nowSeconds: now,
    headers: { webhookId, webhookTimestamp: timestamp, webhookSignature: `v1,wrong v1,${valid}` } };
  assert.equal(verifyYocoWebhookSignatureWithSecret(base), true);
  assert.equal(verifyYocoWebhookSignatureWithSecret({ ...base, rawBody: `${rawBody} ` }), false);
  assert.equal(verifyYocoWebhookSignatureWithSecret({ ...base, nowSeconds: now + 181 }), false);
  assert.equal(verifyYocoWebhookSignatureWithSecret({ ...base, headers: { ...base.headers, webhookSignature: "v0,wrong" } }), false);
});

test("Yoco test and live events cannot cross runtime authority", () => {
  assert.equal(yocoEventModeMatches("test", "test"), true);
  assert.equal(yocoEventModeMatches("live", "live"), true);
  assert.equal(yocoEventModeMatches("live", "test"), false);
  assert.equal(yocoEventModeMatches("test", "live"), false);
  assert.equal(yocoEventModeMatches(undefined, "test"), false);
});
