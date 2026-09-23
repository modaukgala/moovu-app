import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types requires explicit extensions.
import { readOfferAttempts, untriedCandidatesFirst } from "./attemptHistory.ts";

test("canonical history prioritizes untried drivers despite an empty legacy array", () => {
  assert.deepEqual(untriedCandidatesFirst([{ driverId: "A" }, { driverId: "B" }],
    [{ driver_id: "A", status: "expired", dispatch_cycle: 1 }], 2), [{ driverId: "B" }]);
});
test("only a later explicit round retries exhausted expired candidates", () => {
  const rows = [{ driverId: "A" }];
  const history = [{ driver_id: "A", status: "expired", dispatch_cycle: 1 }];
  assert.deepEqual(untriedCandidatesFirst(rows, history, 1), []);
  assert.deepEqual(untriedCandidatesFirst(rows, history, 2), rows);
});
test("declined, accepted, cancelled, active and unknown-cycle offers are not retried", () => {
  for (const status of ["declined", "accepted", "cancelled", "shown", "pending"]) {
    assert.deepEqual(untriedCandidatesFirst([{ driverId: "A" }],
      [{ driver_id: "A", status, dispatch_cycle: 1 }], 2), []);
  }
  assert.deepEqual(untriedCandidatesFirst([{ driverId: "A" }],
    [{ driver_id: "A", status: "expired", dispatch_cycle: null }], 2), []);
});
test("large candidate batches retain rank while advancing past previous attempts", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ driverId: String(i) }));
  const history = rows.slice(0, 25).map(row => ({ driver_id: row.driverId, status: "expired", dispatch_cycle: 1 }));
  assert.deepEqual(untriedCandidatesFirst(rows, history, 2), rows.slice(25));
});

test("attempt history includes declines beyond the first database page", async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ driver_id: "A",
    status: i === 1000 ? "declined" : "expired", dispatch_cycle: 1 }));
  const query = {
    select: () => query, eq: () => query, in: () => query, order: () => query,
    range: async (start: number, end: number) => ({ data: rows.slice(start, end + 1), error: null }),
  };
  const mock = { from: () => query } as unknown as Parameters<typeof readOfferAttempts>[0];
  const result = await readOfferAttempts(mock, "trip", ["A"]);
  assert.equal(result.data?.length, 1001);
  assert.deepEqual(untriedCandidatesFirst([{ driverId: "A" }], result.data ?? [], 2), []);
});

test("attempt history fails closed when a later database page fails", async () => {
  const failure = { message: "Unavailable" };
  const query = {
    select: () => query, eq: () => query, in: () => query, order: () => query,
    range: async (start: number) => start === 0
      ? { data: Array.from({ length: 1000 }, () => ({ driver_id: "A", status: "expired", dispatch_cycle: 1 })), error: null }
      : { data: null, error: failure },
  };
  const mock = { from: () => query } as unknown as Parameters<typeof readOfferAttempts>[0];
  const result = await readOfferAttempts(mock, "trip", ["A"]);
  assert.equal(result.data, null);
  assert.equal(result.error, failure);
});
