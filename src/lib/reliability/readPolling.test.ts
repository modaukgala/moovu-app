import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types requires explicit extensions.
import { createReadController, pollDelay, READ_POLICIES, readFailure, startReadLoop } from "./readPolling.ts";

test("jitter is deterministic, positive, and bounded by operational caps", () => {
  for (const policy of Object.values(READ_POLICIES)) {
    for (const connected of [true, false]) for (const failures of [0, 1, 2, 10]) {
      for (const random of [0, 0.5, 1]) {
        const delay = pollDelay(policy, failures, connected, () => random);
        assert.ok(delay >= policy.normalMs && delay <= policy.maxMs);
      }
    }
    assert.ok(pollDelay(policy, 0, false, () => 0.5) >= pollDelay(policy, 0, true, () => 0.5));
  }
});

test("timer and realtime share one in-flight request; failures cool down and recover", async () => {
  let now = 0;
  let release!: () => void;
  let calls = 0;
  const controller = createReadController(READ_POLICIES.driverOffers, "test", { now: () => now, random: () => 0.5, log: () => {} });
  const task = async () => { calls++; await new Promise<void>((resolve) => { release = resolve; }); return false; };
  const first = controller.run(task);
  const second = controller.run(task);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(controller.failures(), 1);
  assert.equal(controller.delay(), 15_000);
  await controller.run(async () => { calls++; });
  assert.equal(calls, 1, "Realtime may not bypass failure cooldown");
  now += 15_000;
  await controller.run(async () => false);
  assert.equal(controller.delay(), 20_000);
  now += 20_000;
  await controller.run(async () => true);
  assert.equal(controller.failures(), 0);
  assert.equal(controller.delay(), 10_000);
});

test("hidden and terminal reads never start", async () => {
  let visible = false;
  let calls = 0;
  const controller = createReadController(READ_POLICIES.customerTrip, "test", { visible: () => visible });
  const task = async () => { calls++; };
  await controller.run(task);
  visible = true;
  controller.setTerminal(true);
  await controller.run(task);
  assert.equal(calls, 0);
});

test("Realtime reconnect does not erase API failure backoff; auth and server errors are distinguished", async () => {
  const logs: Array<Record<string, string | number | boolean>> = [];
  let now = 0;
  const controller = createReadController(READ_POLICIES.customerTrip, "test", { now: () => now, random: () => 0.5, log: (entry) => logs.push(entry) });
  await controller.run(async () => readFailure(401));
  controller.setConnected(false);
  controller.setConnected(true);
  assert.equal(controller.failures(), 1);
  assert.equal(controller.delay(), 30_000);
  assert.equal(logs[0].errorCategory, "authentication");
  now += 30_000;
  await controller.run(async () => readFailure(503));
  assert.equal(logs[1].errorCategory, "server");
  now += 45_000;
  await controller.run(async () => true);
  assert.equal(logs[2].recovered, true);
});

test("resume after an expired cooldown still has bounded jitter, not a tight loop", async () => {
  let now = 0;
  const controller = createReadController(READ_POLICIES.driverOffers, "test", { now: () => now, random: () => 0.5, log: () => {} });
  await controller.run(async () => false);
  now = 60_000;
  assert.equal(controller.delay(), 15_000);
});

test("component cleanup abort is not classified as an API outage", async () => {
  const controller = createReadController(READ_POLICIES.customerTrip, "test", { log: () => {} });
  const pending = controller.run((signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true })));
  await Promise.resolve();
  controller.abort();
  await pending;
  assert.equal(controller.failures(), 0);
  assert.equal(await controller.run(async () => true), true);
});

test("hidden tabs suspend scheduled work and remove the visibility listener on cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const events = new EventTarget();
  const documentDouble = { hidden: true, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentDouble });
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  let calls = 0;
  const controller = createReadController(READ_POLICIES.customerTrip, "test", { random: () => 0.5 });
  const stop = startReadLoop(controller, () => controller.run(async () => { calls++; }));
  t.mock.timers.tick(60_000);
  assert.equal(calls, 0);
  documentDouble.hidden = false;
  events.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(15_000);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(calls, 1);
  stop();
  events.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(60_000);
  assert.equal(calls, 1);
});

test("timeout aborts the read and releases the in-flight guard after settlement", async () => {
  const controller = createReadController(READ_POLICIES.customerTrip, "test", { timeoutMs: 5, log: () => {} });
  await controller.run((signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true })));
  assert.equal(controller.failures(), 1);
});

test("recursive loop schedules after settlement, cleans up, and stops at terminal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const controller = createReadController(READ_POLICIES.driverOffers, "test", { random: () => 0.5, timeoutMs: 100_000, log: () => {} });
  let calls = 0;
  let release!: () => void;
  const stop = startReadLoop(controller, () => controller.run(async () => {
    calls++;
    await new Promise<void>((resolve) => { release = resolve; });
  }));
  t.mock.timers.tick(0);
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  t.mock.timers.tick(9_999);
  assert.equal(calls, 1);
  controller.setTerminal(true);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(calls, 1);
  stop();
  t.mock.timers.tick(60_000);
  assert.equal(calls, 1);
});
