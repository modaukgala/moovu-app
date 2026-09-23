import assert from "node:assert/strict";
import test from "node:test";
import type { OutboxJob } from "./outboxDelivery";
const { isOutboxWorkerAuthorized, outboxNotificationEventKey, processOutboxJob } = await import(
  new URL("./outboxDelivery.ts", import.meta.url).href
);

const job: OutboxJob = {
  id: "job-1",
  business_event_id: "event-1",
  event_type: "trip_completed",
  payload: { trip_id: "trip-1" },
  attempts: 1,
};

test("outbox worker fails closed when its dedicated secret is absent", () => {
  const previous = process.env.OUTBOX_JOB_SECRET;
  delete process.env.OUTBOX_JOB_SECRET;
  assert.equal(isOutboxWorkerAuthorized(new Request("http://local")), false);
  if (previous === undefined) delete process.env.OUTBOX_JOB_SECRET;
  else process.env.OUTBOX_JOB_SECRET = previous;
});

test("outbox worker accepts only the configured bearer or explicit secret", () => {
  const previous = process.env.OUTBOX_JOB_SECRET;
  process.env.OUTBOX_JOB_SECRET = "test-secret";
  assert.equal(isOutboxWorkerAuthorized(new Request("http://local")), false);
  assert.equal(isOutboxWorkerAuthorized(new Request("http://local", { headers: { authorization: "Bearer wrong" } })), false);
  assert.equal(isOutboxWorkerAuthorized(new Request("http://local", { headers: { authorization: "Bearer test-secret" } })), true);
  if (previous === undefined) delete process.env.OUTBOX_JOB_SECRET;
  else process.env.OUTBOX_JOB_SECRET = previous;
});

test("a retry reuses the same per-user application notification identity", async () => {
  const keys: string[] = [];
  const finishes: Array<[boolean, string | null]> = [];
  let first = true;
  const dependencies = {
    resolveIntents: async () => [{
      userId: "user-1", role: "customer" as const, title: "Done", body: "Trip completed",
      url: "/ride/trip-1", data: { tripId: "trip-1" },
    }],
    send: async (_intent: unknown, key: string) => {
      keys.push(key);
      if (first) { first = false; return { ok: false, failed: 1, message: "provider response lost" }; }
      return { ok: true, failed: 0 };
    },
    finish: async (_id: string, delivered: boolean, error: string | null) => { finishes.push([delivered, error]); },
  };
  assert.equal((await processOutboxJob(job, dependencies)).ok, false);
  assert.equal((await processOutboxJob({ ...job, attempts: 2 }, dependencies)).ok, true);
  assert.deepEqual(keys, ["phase05:event-1:user-1", "phase05:event-1:user-1"]);
  assert.equal(new Set(keys).size, 1);
  assert.deepEqual(finishes.map(([delivered]) => delivered), [false, true]);
});

test("Phase 4 notification failure retries delivery without rerunning the financial writer", async () => {
  const phase4Job = { ...job, id: "phase4-outbox", business_event_id: "phase4-business-event",
    event_type: "customer_no_show", payload: { trip_id: "phase4-trip" } };
  const keys: string[] = [];
  const acknowledgements: boolean[] = [];
  let failed = false;
  const dependencies = {
    resolveIntents: async () => [{ userId: "customer-1", role: "customer" as const,
      title: "No-show", body: "Fee assessed", url: "/ride/phase4-trip", data: {} }],
    send: async (_intent: unknown, key: string) => {
      keys.push(key);
      if (!failed) { failed = true; return { ok: false, failed: 1 }; }
      return { ok: true, failed: 0 };
    },
    finish: async (_id: string, delivered: boolean) => { acknowledgements.push(delivered); },
  };
  assert.equal((await processOutboxJob(phase4Job, dependencies)).ok, false);
  assert.equal((await processOutboxJob({ ...phase4Job, attempts: 2 }, dependencies)).ok, true);
  assert.deepEqual(acknowledgements, [false, true]);
  assert.deepEqual(keys, ["phase05:phase4-business-event:customer-1", "phase05:phase4-business-event:customer-1"]);
});

test("invalid or exhausted claims are failed without sending", async () => {
  let sends = 0;
  const result = await processOutboxJob({ ...job, attempts: 9 }, {
    resolveIntents: async () => [],
    send: async () => { sends += 1; return { ok: true, failed: 0 }; },
    finish: async () => undefined,
  });
  assert.equal(result.ok, false);
  assert.equal(sends, 0);
});

test("event identity is stable per business event and recipient", () => {
  assert.equal(outboxNotificationEventKey("event-a", "user-a"), "phase05:event-a:user-a");
  assert.notEqual(outboxNotificationEventKey("event-a", "user-a"), outboxNotificationEventKey("event-a", "user-b"));
});
