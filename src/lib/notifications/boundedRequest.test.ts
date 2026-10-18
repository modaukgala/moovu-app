import assert from "node:assert/strict";
import test from "node:test";
type RequestFunction = typeof import("./boundedRequest").boundedNotificationRequest;
type OperationFunction = typeof import("./boundedRequest").boundedNotificationOperation;
const { boundedNotificationRequest, boundedNotificationOperation } = await import(new URL("./boundedRequest.ts", import.meta.url).href) as {
  boundedNotificationRequest: RequestFunction;
  boundedNotificationOperation: OperationFunction;
};

test("notification registration returns a completed response without aborting it", async () => {
  let signal: AbortSignal | undefined;
  const response = new Response(null, { status: 200 });
  const result = await boundedNotificationRequest("/api/push/fcm/register", { method: "POST" }, 50,
    async (_input, init) => {
      signal = init?.signal ?? undefined;
      return response;
    });
  assert.equal(result, response);
  assert.equal(signal?.aborted, false);
});

test("notification registration fails promptly and aborts a stalled network request", async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(
    boundedNotificationRequest("/api/push/fcm/register", { method: "POST" }, 5,
      (_input, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }),
    /timed out.*try again/i,
  );
  assert.equal(signal?.aborted, true);
});

test("a stalled native or Firebase token request cannot hold the UI indefinitely", async () => {
  await assert.rejects(
    boundedNotificationOperation(() => new Promise<string>(() => {}), 5),
    /timed out.*try again/i,
  );
});

test("notification registration can succeed on retry after a timed-out request", async () => {
  let attempts = 0;
  const request: typeof fetch = async () => {
    attempts += 1;
    if (attempts === 1) return new Promise<Response>(() => {});
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  await assert.rejects(
    boundedNotificationRequest("/api/push/fcm/register", { method: "POST" }, 5, request),
    /timed out.*try again/i,
  );
  const recovered = await boundedNotificationRequest("/api/push/fcm/register", { method: "POST" }, 50, request);
  assert.equal(recovered.ok, true);
  assert.equal(attempts, 2);
});
