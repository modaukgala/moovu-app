import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types requires the extension.
import { earningsPeriod, summariseTrips, paymentClass, type EarningsTrip } from "./earningsMetrics.ts";

test("Johannesburg reporting days include completion at midnight and exclude the following midnight", () => {
  const period = earningsPeriod(new URLSearchParams({ from: "2026-11-25", to: "2026-11-25" }));
  assert.equal(period.start, "2026-11-24T22:00:00.000Z");
  assert.equal(period.end, "2026-11-25T22:00:00.000Z");
  const rows = [
    { id: "included", created: "2026-11-23", completed: period.start, status: "completed" },
    { id: "late", created: period.start, completed: period.end, status: "completed" },
    { id: "ongoing", created: period.start, completed: period.start, status: "ongoing" },
    { id: "early", created: "2026-11-24", completed: "2026-11-24T21:59:59.999Z", status: "completed" },
  ];
  assert.deepEqual(rows.filter((row) => row.status === "completed" && row.completed >= period.start && row.completed < period.end)
    .map((row) => row.id), ["included"]);
  assert.throws(() => earningsPeriod(new URLSearchParams({ from: "2026-02-30", to: "2026-03-01" })));
});

test("stored snapshots, zero and missing amounts remain distinct", () => {
  const row: EarningsTrip = { id: "trip", driver_id: "driver", completed_at: "2026-11-25", payment_method: "online",
    fare_amount: 50, commission_pct: 7, commission_amount: 3.5, driver_net_earnings: 42 };
  const result = summariseTrips([row]);
  assert.equal(result.gross, 50);
  assert.equal(result.commission, 3.5);
  assert.equal(result.net, 42);
  assert.deepEqual(result.methods.online, { count: 1, gross: 50 });
  assert.ok(!("verified" in result));
  assert.equal(summariseTrips([{ ...row, commission_amount: null }]).commission, null);
  assert.equal(summariseTrips([{ ...row, commission_amount: 0 }]).commission, 0);
  assert.deepEqual(["cash", "bank_transfer", "online", "other", null].map(paymentClass), ["cash", "transfer", "online", "unknown", "unknown"]);
});
