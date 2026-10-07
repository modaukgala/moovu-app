import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
// @ts-expect-error Native Node tests require the TypeScript extension.
import { requestCheckout } from "./checkoutContract.ts";
const input = { amountCents: 5500, currency: "ZAR" as const, idempotencyKey: "moovu:checkout:fixture",
  successUrl: "https://moovurides.co.za/payment/success", cancelUrl: "https://moovurides.co.za/payment/cancel" };
const config = () => ({ secretKey: `sk_test_${randomBytes(32).toString("hex")}`, mode: "test" as const, baseUrl: "https://payments.yoco.com/api" });
const response = { id: "checkout_fixture", redirectUrl: "https://c.yoco.com/checkout/fixture",
  amount: 5500, currency: "ZAR", processingMode: "test", status: "created" };
test("TRIP checkout sends canonical cents and stable provider idempotency on concurrent retries", async () => {
  const requests: RequestInit[] = [];
  const mock: typeof fetch = async (url, init) => {
    assert.equal(url, "https://payments.yoco.com/api/checkouts"); requests.push(init!);
    return new Response(JSON.stringify(response));
  };
  const results = await Promise.all([requestCheckout(input, config(), mock), requestCheckout(input, config(), mock)]);
  assert.deepEqual(results[0], results[1]);
  for (const r of requests) {
    assert.equal(new Headers(r.headers).get("Idempotency-Key"), input.idempotencyKey);
    assert.equal(JSON.parse(String(r.body)).amount, 5500);
    assert.equal(r.redirect, "error");
  }
  assert.equal("verified" in results[0], false);
});
for (const patch of [{ amount: 5501 }, { currency: "USD" }, { processingMode: "live" },
  { id: "" }, { status: "succeeded" }, { redirectUrl: "https://evil.example" },
  { redirectUrl: "https://user:password@c.yoco.com/checkout/x" }]) {
  test(`TRIP response rejects ${Object.keys(patch)[0]} mismatch`, async () => {
    await assert.rejects(() => requestCheckout(input, config(), async () => new Response(JSON.stringify({ ...response, ...patch }))));
  });
}
test("invalid amount/key/provider origin/mode fail before transport", async () => {
  let count = 0; const mock: typeof fetch = async () => { count++; return new Response("{}"); };
  for (const value of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(() => requestCheckout({ ...input, amountCents: value }, config(), mock));
  await assert.rejects(() => requestCheckout({ ...input, idempotencyKey: " " }, config(), mock));
  await assert.rejects(() => requestCheckout(input, { ...config(), baseUrl: "https://evil.example" }, mock));
  await assert.rejects(() => requestCheckout(input, { ...config(), mode: "live" }, mock));
  assert.equal(count, 0);
});
test("transport failure is sanitized and never returns financial success", async () => {
  const c = config();
  await assert.rejects(() => requestCheckout(input, c, async () => { throw Error(c.secretKey); }),
    e => e instanceof Error && !e.message.includes(c.secretKey));
  for (const status of [403, 409, 422, 500]) await assert.rejects(() => requestCheckout(input, c, async () => new Response("{}", { status })));
});
test("all shared callers use persistent attempt identity; Customer confirms binding row updated", () => {
  for (const route of ["checkout", "driver/checkout"]) {
    const code = readFileSync(`src/app/api/payments/yoco/${route}/route.ts`, "utf8");
    assert.ok(code.includes("idempotencyKey: `moovu:checkout:${attemptId}`"));
    assert.ok(code.includes('?.state === "CREATED")'));
    assert.ok(code.includes("Uncertain checkout requires reconciliation before retry."));
  }
  const trip = readFileSync("src/app/api/payments/yoco/checkout/route.ts", "utf8");
  assert.ok(trip.includes("updateError || !updatedAttempt"));
  const retired = readFileSync("src/app/api/payments/yoco/driver/subscription/checkout/route.ts", "utf8");
  assert.match(retired, /status:\s*410/);
  assert.doesNotMatch(retired, /requestCheckout|callHardenedRpc|\.insert\(/);
});
