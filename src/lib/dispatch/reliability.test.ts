import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
// @ts-expect-error Node strip-types requires explicit extensions.
import { DISPATCH_CONFIG } from "./config.ts";
// @ts-expect-error Node strip-types requires explicit extensions.
import { cappedCandidates, MAX_DISPATCH_ATTEMPTS, retryDelayMs, settledPool } from "./reliability.ts";
// @ts-expect-error Node strip-types requires explicit extensions.
import { expireTripOffers } from "./expireTripOffers.ts";

test("100 ranked candidates are capped without changing order; preferred remains selectable", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ driverId: String(i) }));
  assert.deepEqual(cappedCandidates(rows, DISPATCH_CONFIG.maxCandidatesPerStep), rows.slice(0, DISPATCH_CONFIG.maxCandidatesPerStep));
  assert.deepEqual(cappedCandidates(rows, DISPATCH_CONFIG.maxCandidatesPerStep, "99"), [rows[99]]);
  assert.equal(cappedCandidates(rows, DISPATCH_CONFIG.maxCandidatesPerStep, "missing").length, 0);
  assert.equal(rows.length, 100);
});

test("trip A expiry leaves trip B, accepted, declined, null and future deadlines unchanged", async () => {
  type Row = { trip_id: string; status: string; accept_deadline_at: string | null };
  const rows: Row[] = [
    { trip_id: "A", status: "pending", accept_deadline_at: "2026-08-01" },
    { trip_id: "B", status: "pending", accept_deadline_at: "2026-08-01" },
    { trip_id: "A", status: "accepted", accept_deadline_at: "2026-08-01" },
    { trip_id: "A", status: "declined", accept_deadline_at: "2026-08-01" },
    { trip_id: "A", status: "shown", accept_deadline_at: "2026-09-01" },
    { trip_id: "A", status: "shown", accept_deadline_at: null },
  ];
  const predicates: Array<(row: Row) => boolean> = [];
  const query = {
    update() { return query; },
    eq(key: keyof Row, value: string) { predicates.push((row) => row[key] === value); return query; },
    in(key: keyof Row, values: string[]) { predicates.push((row) => values.includes(String(row[key]))); return query; },
    lte(key: keyof Row, value: string) {
      predicates.push((row) => row[key] != null && row[key]! <= value);
      rows.filter((row) => predicates.every((predicate) => predicate(row))).forEach((row) => { row.status = "expired"; });
      return Promise.resolve({ error: null });
    },
  };
  // A narrow query-builder double: no credentials, network or production writes.
  const client = { from(table: string) { assert.equal(table, "driver_trip_offers"); return query; } } as unknown as SupabaseClient;
  await expireTripOffers(client, "A", "2026-08-30");
  assert.deepEqual(rows.map((row) => row.status), ["expired", "pending", "accepted", "declined", "shown", "shown"]);
});

test("retry failures back off and attempt five is terminal", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(retryDelayMs), [10_000, 30_000, 60_000, 120_000, null, null]);
  assert.equal(retryDelayMs(Number.NaN), null);
  assert.equal(MAX_DISPATCH_ATTEMPTS, 5);
});

test("notification pool stays bounded and settles remaining tasks after errors", async () => {
  let active = 0;
  let peak = 0;
  const result = await settledPool(Array.from({ length: 25 }, (_, i) => i), DISPATCH_CONFIG.notificationConcurrency, async (i) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    if (i % 5 === 0) throw new Error("mock provider failure");
  });
  assert.equal(peak, DISPATCH_CONFIG.notificationConcurrency);
  assert.deepEqual(result, { attempted: 25, failed: 5 });
  assert.equal(active, 0);
});

test("READ-ONLY SQL test fixture retains atomic claim, cap, grants and final-attempt success path", () => {
  // Static text assertions only. Never execute this fixture or connect it to a database.
  const sql = readFileSync(new URL("../../../docs/dispatch-job-retry-hardening-migration.sql", import.meta.url), "utf8");
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /attempts < 5/);
  assert.match(sql, /attempts = j.attempts \+ 1/);
  assert.match(sql, /returning j\.\*/);
  assert.match(sql, /grant execute.*claim_due_dispatch_jobs.*to service_role/);
  assert.match(sql, /new\.status = 'pending' and new\.attempts >= 5/);
  const worker = readFileSync(new URL("../../app/api/jobs/dispatch/route.ts", import.meta.url), "utf8");
  assert.match(worker, /job.attempts > MAX_DISPATCH_ATTEMPTS/);
  assert.match(worker, /status: "completed"/);
  assert.match(worker, /\.eq\("status", "processing"\)\.eq\("attempts", job.attempts\)/);
});
