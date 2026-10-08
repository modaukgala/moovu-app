import assert from "node:assert/strict";
import test from "node:test";
import type { OutboxJob } from "./outboxDelivery";
const { isOutboxDeliveryEnabled, isOutboxWorkerAuthorized, outboxNotificationEventKey, phase6InAppHistoryRow, processOutboxJob } = await import(
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

test("outbox delivery stays disabled without an exact true flag", () => {
  const previous = process.env.PHASE05_OUTBOX_ENABLED;
  delete process.env.PHASE05_OUTBOX_ENABLED;
  assert.equal(isOutboxDeliveryEnabled(), false);
  process.env.PHASE05_OUTBOX_ENABLED = "TRUE";
  assert.equal(isOutboxDeliveryEnabled(), false);
  process.env.PHASE05_OUTBOX_ENABLED = "true";
  assert.equal(isOutboxDeliveryEnabled(), true);
  if (previous === undefined) delete process.env.PHASE05_OUTBOX_ENABLED;
  else process.env.PHASE05_OUTBOX_ENABLED = previous;
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

test("partial multi-device provider acceptance is not acknowledged as complete", async () => {
  const acknowledgements: Array<[boolean, string | null]> = [];
  const result = await processOutboxJob({ ...job, event_type: "phase6_application_approved" }, {
    resolveIntents: async () => [{ userId: "driver-1", role: "driver" as const,
      title: "Approved", body: "Application approved", url: "/driver/onboarding", data: {} }],
    send: async () => ({ ok: true, delivered: 1, failed: 1, message: "One device failed after another accepted." }),
    finish: async (_id: string, delivered: boolean, error: string | null) => { acknowledgements.push([delivered, error]); },
  });
  assert.equal(result.ok, false);
  assert.equal(acknowledgements[0][0], false);
  assert.match(acknowledgements[0][1] ?? "", /^PROVIDER_DELIVERY_UNCERTAIN:/);
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

test("Phase 6 in-app history uses the existing per-recipient event identity", () => {
  const intent = { userId: "driver-1", role: "driver" as const, title: "Application evidence needs attention",
    body: "Rear of Vehicle: Image is blurry.", url: "/driver/onboarding?requirement=rear",
    data: { type: "phase6_correction_requested", requirement: "rear" } };
  const key = outboxNotificationEventKey("review-event", intent.userId);
  assert.deepEqual(phase6InAppHistoryRow(intent, key), {
    user_id: "driver-1", role: "driver", title: intent.title, body: intent.body,
    url: intent.url, data: intent.data, delivery_status: "queued", event_key: key,
  });
});
