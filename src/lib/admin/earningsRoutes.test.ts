import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Row = Record<string, unknown>;
const start = "2026-11-24T22:00:00.000Z";
const end = "2026-11-25T22:00:00.000Z";
const trip = { id: "a", driver_id: "d", status: "completed", completed_at: start, created_at: "2026-11-23",
  fare_amount: 49, commission_pct: 7, commission_amount: 3 as number | null, driver_net_earnings: 40, payment_method: "online" };
function fixture() {
  return {
    trips: [trip, ...["cash", "transfer", "other"].map((payment_method, i) => ({ ...trip, id: String(i), payment_method })),
      { ...trip, id: "late", created_at: start, completed_at: end, fare_amount: 80 },
      { ...trip, id: "early", completed_at: "2026-11-24T21:59:59.999Z" },
      { ...trip, id: "open", created_at: start, status: "ongoing" }],
    drivers: Array.from({ length: 12 }, (_, i) => ({ id: i ? String(i) : "d", first_name: "Driver" })),
    driver_settlements: [{ id: "s", amount_paid: 4, created_at: start }],
    driver_subscription_payments: [{ id: "s", amount_paid: 100, created_at: start }],
    driver_payment_requests: [{ id: "proof", payment_type: "combined", amount_submitted: 999, created_at: start }],
    phase5_membership_payments: [
      ...["m1", "m2", "m3"].map((id, i) => ({ id, status: "APPROVED", financial_transaction_id: i < 2 ? "t1" : "t2", amount_cents: 9900, reviewed_at: start })),
      { id: "proof", status: "SUBMITTED", financial_transaction_id: "t3", amount_cents: 9900, reviewed_at: start },
      { id: "unlinked", status: "APPROVED", financial_transaction_id: null, amount_cents: 9900, reviewed_at: start },
    ],
    financial_transactions: ["t1", "t2"].map((id) => ({ id, transaction_state: "POSTED" })),
  };
}

function harness(tables: Record<string, Row[]>, options: { cap?: number; fail?: string; verification?: unknown } = {}) {
  const calls: { name: string; args: Row }[] = [];
  let active = 0;
  let peak = 0;
  const db = {
    from(table: string) {
      assert.ok(table in tables);
      let rows = [...tables[table]];
      const order: [string, number][] = [];
      let range = [0, Infinity];
      const query = {
        select: () => query,
        eq(key: string, value: unknown) { rows = rows.filter((row) => row[key] === value); return query; },
        gte(key: string, value: string) { rows = rows.filter((row) => String(row[key]) >= value); return query; },
        lt(key: string, value: string) { rows = rows.filter((row) => String(row[key]) < value); return query; },
        not(key: string, op: string, value: unknown) { assert.equal(op, "is"); rows = rows.filter((row) => row[key] !== value); return query; },
        in(key: string, ids: unknown[]) { rows = rows.filter((row) => ids.includes(row[key])); return query; },
        order(key: string, arg?: { ascending: boolean }) { order.push([key, arg?.ascending === false ? -1 : 1]); return query; },
        range(from: number, to: number) { range = [from, to + 1]; return query; },
        then(resolve: (value: unknown) => void) {
          rows.sort((a, b) => {
            for (const [key, sign] of order) {
              const comparison = String(a[key]).localeCompare(String(b[key]));
              if (comparison) return comparison * sign;
            }
            return 0;
          });
          resolve(options.fail === table ? { error: "offline", data: null } :
            { error: null, count: rows.length, data: rows.slice(...range) });
        },
      };
      return query;
    },
    async rpc(name: string, args: Row) {
      calls.push({ name, args });
      if (name === "admin_verified_yoco_payments_report") {
        return { error: options.fail === "yoco" ? "offline" : null,
          data: options.verification === undefined ? { total_cents: 1200, trip_cents: 1000 } : options.verification };
      }
      assert.equal(name, "phase05b_driver_debt");
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      return options.fail === "debt" && args.p_driver_id === "d" ? { error: "offline" } : {
        error: null, data: { driver_id: args.p_driver_id, balance_due: 62, total_commission: 100,
          total_settled: 28, cancellation_credits: 10, total_driver_net: 500, total_trips_completed: 12 },
      };
    },
  };
  const load = (path: string): Row => {
    const exports: Row = {};
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      exports, URL,
      require(name: string) {
        if (name === "next/server") return { NextResponse: Response };
        if (name === "@/lib/auth/admin") return { isFinancialAdminRole: () => true,
          requireAdminUser: async () => ({ ok: true, supabaseAdmin: db, profile: { role: "admin" } }) };
        const moduleName = name.split("/").at(-1);
        assert.ok(["earningsMetrics", "earningsRead", "boundedRetrieval", "commissionDebt"].includes(moduleName ?? ""), name);
        const mod = load(`./${moduleName}.ts`);
        if (moduleName !== "boundedRetrieval" || options.cap === undefined) return mod;
        const collect = mod.collectBoundedPages as (input: Row) => unknown;
        return { ...mod, collectBoundedPages: (input: Row) => collect({ ...input, maxRows: options.cap }) };
      },
    });
    return exports;
  };
  return { calls, peak: () => peak, async read(route: string, day = "2026-11-25", page = 1) {
    const { GET } = load(`../../app/api/admin/${route}/route.ts`) as { GET: (req: Request) => Promise<Response> };
    const response = await GET(new Request(`https://local.invalid/?from=${day}&to=${day}&page=${page}`));
    return { status: response.status, body: await response.json() };
  } };
}

test("FIN-03 actual route uses Johannesburg completion dates and stored payment snapshots", async () => {
  const mock = harness(fixture(), { verification: { total_cents: 0, trip_cents: 0 } });
  const { body } = await mock.read("reports/driver-earnings");
  assert.deepEqual(body.rows.map((row: Row) => row.id), ["a", "2", "1", "0"]);
  assert.equal(body.rows[0].commission_pct, 7);
  assert.equal(body.totals.gross, 196);
  assert.equal(body.totals.commission, 12);
  assert.equal(body.totals.net, 160);
  assert.deepEqual(Object.values(body.totals.methods).map((value) => (value as Row).count), [1, 1, 1, 1]);
  assert.equal(body.verifiedOnlineTripReceipts, 0);
  assert.equal(body.driverPayoutObligations, null);
  assert.doesNotMatch(JSON.stringify(body), /subscription.*due/i);
  assert.equal(mock.calls[0].args.p_from, start);
  assert.equal(mock.calls[0].args.p_to, end);
});

test("FIN-03 actual route pages historical rows independently of totals and exposes missing data", async () => {
  const tables = fixture();
  tables.trips.push(...Array.from({ length: 31 }, (_, i) => ({ ...trip, id: `old-${i}`,
    fare_amount: 0, driver_net_earnings: 0, commission_amount: i ? 0 : null })));
  const mock = harness(tables);
  const first = (await mock.read("reports/driver-earnings")).body;
  const second = (await mock.read("reports/driver-earnings", "2026-11-25", 2)).body;
  assert.equal(first.rows.length, 30);
  assert.equal(second.rows.length, 5);
  assert.equal(second.rows.at(-1).id, "0");
  assert.deepEqual(first.totals, second.totals);
  assert.equal(first.totals.commission, null);
  assert.ok(first.rows.some((row: Row) => row.fare_amount === 0));
  const limited = (await harness(tables, { cap: 3 }).read("reports/driver-earnings", "2026-11-25", 2)).body;
  assert.equal(limited.totalsState, "partial");
  assert.equal(limited.totals, null);
  assert.equal(limited.rows.length, 5);
  assert.equal((await harness(tables, { fail: "trips" }).read("reports/driver-earnings")).status, 503);
});

test("FIN-01 actual overview keeps authoritative debt independent and separates receipt sources", async () => {
  const mock = harness(fixture());
  const today = (await mock.read("earnings")).body;
  const tomorrow = (await mock.read("earnings", "2026-11-26")).body;
  assert.equal(today.trips.gross, 196);
  assert.equal(tomorrow.trips.gross, 80);
  assert.equal(today.trips.commission, 12);
  assert.equal(tomorrow.trips.commission, 3);
  assert.equal(today.trips.net, 160);
  assert.equal(today.direct.value, 4);
  assert.equal(tomorrow.direct.value, 0);
  assert.equal(today.subscriptions.value, 100);
  assert.equal(today.membership.value, 198);
  assert.equal(today.online.total, 12);
  assert.equal(mock.calls.filter((call) => call.name === "admin_verified_yoco_payments_report")[1].args.p_from, end);
  assert.deepEqual(today.debt, { value: 744, complete: true });
  assert.deepEqual(tomorrow.debt, today.debt);
  assert.equal(mock.calls.filter((call) => call.name === "phase05b_driver_debt").length, 24);
  assert.ok(mock.peak() > 1 && mock.peak() <= 8);
  for (const key of ["internalRecovery", "totalSettled", "grossPayout", "netPayout", "manualPayout", "verifiedManualPayout", "outstandingPayout"]) {
    assert.equal(today[key], null, key);
  }
});

test("the shared earnings client integrates timeout, retry and stale-request handling", () => {
  const source = readFileSync(new URL("../../components/finance/AdminRecordedEarnings.tsx", import.meta.url), "utf8");
  assert.match(source, /createCommissionHistoryRequest<string, Result>\(\)/);
  assert.match(source, /request\.run\(/);
  assert.match(source, /fetch\(url, \{ signal,/);
  assert.match(source, /setLoading\(state\.loading\)/);
  assert.match(source, /setResult\(state\.result\)/);
  assert.match(source, /return \(\) => request\.invalidate\(\)/);
  assert.match(source, /\[from, to, page, report, retry, request\]/);
  assert.match(source, /setRetry\(retry \+ 1\)\}>Try again/);
});

test("FIN-01 independent financial failures and retrieval limits remain unavailable", async () => {
  for (const [fail, key] of [["trips", "trips"], ["driver_settlements", "direct"], ["driver_subscription_payments", "subscriptions"],
    ["financial_transactions", "membership"], ["debt", "debt"], ["yoco", "online"]]) {
    const { body } = await harness(fixture(), { fail }).read("earnings");
    assert.equal(body[key], null, key);
    if (key !== "direct") assert.equal(body.direct.value, 4);
    if (key !== "trips") assert.equal(body.trips.gross, 196);
  }
  const tables = fixture();
  tables.financial_transactions.pop();
  assert.equal((await harness(tables).read("earnings")).body.membership, null);
  assert.equal((await harness(tables, { verification: {} }).read("earnings")).body.online, null);
  const { body } = await harness(tables, { cap: 3 }).read("earnings");
  assert.deepEqual(body.debt, { value: null, complete: false });
  assert.equal(body.tripsComplete, false);
  assert.equal(body.direct.value, 4);
});
