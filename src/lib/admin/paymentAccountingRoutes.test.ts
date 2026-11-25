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
    trip_cancellation_fees: [],
    phase5_membership_payments: [
      ...["m1", "m2", "m3"].map((id, i) => ({ id, status: "APPROVED", financial_transaction_id: i < 2 ? "t1" : "t2", amount_cents: 9900, reviewed_at: start })),
      { id: "proof", status: "SUBMITTED", financial_transaction_id: "t3", amount_cents: 9900, reviewed_at: start },
      { id: "unlinked", status: "APPROVED", financial_transaction_id: null, amount_cents: 9900, reviewed_at: start },
    ],
    financial_transactions: ["t1", "t2"].map((id) => ({ id, transaction_state: "POSTED" })),
  };
}

function harness(tables: Record<string, Row[]>, options: { cap?: number; fail?: string; verification?: unknown; role?: string; unauthenticated?: boolean; missingDriver?: boolean; legacySchema?: boolean; payoutDebt?: number } = {}) {
  const calls: { name: string; args: Row }[] = [];
  let active = 0;
  let peak = 0;
  const db = {
    from(table: string) {
      assert.ok(table in tables);
      let rows = [...tables[table]];
      const order: [string, number][] = [];
      let single = false;
      let range = [0, Infinity];
      let missingLinkColumn = false;
      const query = {
        select: () => query,
        maybeSingle() { single = true; return query; },
        limit(size: number) { range = [0, size]; return query; },
        eq(key: string, value: unknown) { rows = rows.filter((row) => row[key] === value); return query; },
        is(key: string, value: null) {
          if (options.legacySchema && key === "phase4_assessment_id") missingLinkColumn = true;
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
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
          return Promise.resolve(resolve(missingLinkColumn ? { error: { code: "42703", message: "column phase4_assessment_id does not exist" }, data: null } :
            options.fail === table ? { error: "offline", data: null } :
            { error: null, count: rows.length, data: single ? rows[0] ?? null : rows.slice(...range) }));
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
        error: null, data: { driver_id: args.p_driver_id, balance_due: options.payoutDebt ?? 62, total_commission: 100,
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
      exports, URL, process: { env: {} },
      require(name: string) {
        if (name === "next/server") return { NextResponse: Response };
        if (name === "@supabase/supabase-js") return { createClient: () => ({
          ...db, auth: { getUser: async () => options.unauthenticated
            ? { data: { user: null }, error: "unauthorized" } : { data: { user: { id: "driver-user" } }, error: null } },
        }) };
        if (name === "@/lib/finance/phase2DriverEligibility") return {
          resolveDriverFinanceAuthority: async () => ({ ok: true, authority: {} }),
        };
        if (name === "@/lib/auth/admin") return { ...load("../auth/admin.ts"),
          requireAdminUser: async () => options.unauthenticated ? { ok: false, status: 401 } : ({ ok: true, supabaseAdmin: db, profile: { role: options.role ?? "admin" } }) };
        if (["push-server","hardenedRpc","phase2Rpc","phase2Policy","outboxDelivery"].some((suffix) => name.endsWith(suffix))) return {};
        if (name === "@/lib/subscriptions/expireDriverSubscriptions") return { expireDriverSubscriptions: () => { assert.fail("Unexpected expiry mutation"); } };
        if (name === "@/lib/server/phase4Rpc") return {};
        if (name === "@/lib/payments/onlineReport") return load("../payments/onlineReport.ts");
        if (name === "@/lib/admin/applicationSummary") return { PHASE6_NEEDS_REVIEW: ["SUBMITTED"] };
        if (name === "@/lib/payments/driverServer") return { getAuthenticatedDriver: async () =>
          options.missingDriver ? ({ ok: false, status: 404, error: "Driver account not linked." }) : ({ ok: true, driverId: "d", supabaseAdmin: db }) };
        if (name === "@/lib/finance/payoutEstimateRead") return load("../finance/payoutEstimateRead.ts");
        if (name === "./commissionFirstPayout") return load("../finance/commissionFirstPayout.ts");
        if (name === "../earnings/route") return load("../../app/api/admin/earnings/route.ts");
        const moduleName = name.split("/").at(-1);
        assert.ok(["earningsMetrics", "earningsRead", "boundedRetrieval", "commissionDebt", "paymentAllocations", "earningsMetrics", "earningsRead", "yocoFulfilment", "onlineReport", "operationalCounts", "applicationSummary"].includes(moduleName ?? ""), name);
        const mod = load(`./${moduleName}.ts`);
        if (moduleName !== "boundedRetrieval" || options.cap === undefined) return mod;
        const collect = mod.collectBoundedPages as (input: Row) => unknown;
        return { ...mod, collectBoundedPages: (input: Row) => collect({ ...input, maxRows: options.cap }) };
      },
    });
    return exports;
  };
  return { calls, peak: () => peak, async read(route: string, day = "2026-11-25", page = 1, status = "all", to = day, extra = "", method: "GET" | "POST" = "GET") {
    const handlers = load(`../../app/api/${route.startsWith("driver/") ? route : "admin/" + route}/route.ts`) as Record<"GET" | "POST", (req: Request) => Promise<Response>>;
    const response = await handlers[method](new Request(`https://local.invalid/?from=${day}&to=${to}&page=${page}&status=${status}&${extra}`, { method, headers: { Authorization: "Bearer local-fixture" } }));
    return { status: response.status, body: await response.json() };
  } };
}

test("subscription receipt route uses Johannesburg recorded dates and excludes proof values", async () => {
  const tables = fixture();
  tables.driver_subscription_payments.push({ id: "zero", amount_paid: 0, created_at: start },
    { id: "late", amount_paid: 200, created_at: end });
  assert.equal((await harness(tables).read("subscriptions/receipts")).body.total, 100);
  assert.equal((await harness(tables).read("subscriptions/receipts", "2026-11-24")).body.total, 0);
  assert.equal((await harness(tables, { fail: "driver_subscription_payments" }).read("subscriptions/receipts")).status, 503);
});

test("actual payment review GET exposes persisted allocations and rejects unavailable reads", async () => {
  const tables: Record<string, Row[]> = fixture();
  const approved = { id: "a", driver_id: "d", status: "approved", payment_type: "combined", amount_submitted: 180,
    contract_version: "phase-05b-v1", subscription_amount_applied: 100, commission_amount_applied: 60, unapplied_excess: 20 };
  tables.driver_settlements[0].payment_request_id = "a";
  tables.driver_subscription_payments[0].payment_request_id = "a";
  tables.financial_transactions[0].source_id = "a";
  tables.financial_transactions[0].source_type = "DRIVER_PAYMENT_REQUEST";
  tables.driver_payment_requests = [approved, { ...approved, id: "b", contract_version: null },
    { ...approved, id: "c", status: "rejected" }, { ...approved, id: "d", status: "pending_payment_review" }];
  const { body } = await harness(tables).read("payment-reviews");
  assert.deepEqual(body.requests[0].financialReferences, { settlements: ["s"], subscriptions: ["s"], transactions: ["t1"] });
  assert.deepEqual(body.requests[1].financialReferences, { settlements: [], subscriptions: [], transactions: [] });
  assert.equal((await harness(tables, { fail: "driver_settlements" }).read("payment-reviews")).body.requests[0].financialReferences.settlements, null);
  assert.equal((await harness(tables, { role: "support" }).read("payment-reviews")).status, 403);
  assert.deepEqual(body.requests[0].allocation, { subscription: 100, commission: 60, excess: 20 });
  for (const row of body.requests.slice(1)) assert.deepEqual(row.allocation, { subscription: null, commission: null, excess: null });
  assert.equal((await harness(tables, { fail: "driver_payment_requests" }).read("payment-reviews")).status, 500);
});

test("actual MOOVU+ GET pages beyond 100 with independent posted receipts and entitlements", async () => {
  const tables: Record<string, Row[]> = fixture();
  tables.phase5_membership_payments = [
    ...tables.phase5_membership_payments.map((row) => ({ ...row, customer_id: "active", submitted_at: start })),
    ...Array.from({ length: 110 }, (_, i) => ({ id: `z${String(i).padStart(3,"0")}`, status: "SUBMITTED", submitted_at: start, customer_id: "absent" })),
  ];
  tables.phase5_memberships = [
    { id: "1", customer_id: "active", status: "ACTIVE", starts_at: "2000", expires_at: "2999" },
    { id: "2", customer_id: "expired", status: "ACTIVE", starts_at: "2000", expires_at: "2001" },
    { id: "3", customer_id: "inactive", status: "REVERSED", starts_at: "2000", expires_at: "2999" },
  ];
  const mock = harness(tables);
  const first = (await mock.read("phase5-memberships")).body;
  const last = (await mock.read("phase5-memberships", undefined, 5)).body;
  assert.equal(first.total, 115);
  assert.equal(first.payments[0].id, "z109");
  assert.equal(first.payments[0].evidence, "Not approved");
  assert.equal(first.payments[0].membership, "No membership recorded");
  assert.deepEqual(first.membershipCounts, { active: 1, expired: 1, inactive: 1 });
  assert.deepEqual(last.membershipCounts, first.membershipCounts);
  assert.equal(first.receiptCents, 19800);
  assert.equal(last.receiptCents, first.receiptCents);
  const approved = (await mock.read("phase5-memberships", undefined, 1, "APPROVED")).body;
  assert.equal(approved.total, 4);
  assert.equal(approved.payments.find((row: Row) => row.id === "unlinked").evidence, "Unavailable");
  assert.equal(approved.payments.find((row: Row) => row.id === "m1").evidence, "Posted");
  assert.equal((await harness(tables, { role: "support" }).read("phase5-memberships")).status, 403);
  assert.equal((await harness(tables, { fail: "financial_transactions" }).read("phase5-memberships")).body.receiptCents, null);
  assert.equal((await harness(tables, { fail: "phase5_memberships" }).read("phase5-memberships")).body.membershipCounts, null);
  assert.equal((await harness(tables, { cap: 2 }).read("phase5-memberships")).body.receiptComplete, false);
});

test("subscription receipt pages share complete custom-period totals and reject invalid dates", async () => {
  const tables: Record<string, Row[]> = fixture();
  tables.driver_subscription_payments = Array.from({ length: 31 }, (_, i) => ({
    id: String(i).padStart(2, "0"), amount_paid: i === 0 ? 0 : 3, created_at: start, payment_request_id: "proof",
  }));
  tables.driver_subscription_payments.push({ id: "next-day", amount_paid: 8, created_at: end });
  const mock = harness(tables);
  const first = (await mock.read("subscriptions/receipts")).body;
  const second = (await mock.read("subscriptions/receipts", undefined, 2)).body;
  assert.equal(first.count, 31);
  assert.equal(first.rows.length, 25);
  assert.equal(first.rows[0].id, "30");
  assert.equal(second.rows.at(-1).id, "00");
  assert.equal(second.rows.at(-1).amount_paid, 0);
  assert.equal(second.rows.at(-1).proof_type, "combined");
  assert.equal(first.total, 90);
  assert.equal(second.total, first.total);
  assert.equal((await mock.read("subscriptions/receipts", "2026-11-26")).body.total, 8);
  assert.equal((await mock.read("subscriptions/receipts", "2026-02-30")).status, 400);
  assert.equal((await mock.read("subscriptions/receipts", "2026-11-26", 1, "all", "2026-11-25")).status, 400);
  const partial = (await harness(tables, { cap: 2 }).read("subscriptions/receipts")).body;
  assert.equal(partial.complete, false);
  assert.equal(partial.total, null);
  assert.equal(partial.count, 31);
});

test("actual financial report uses independent canonical snapshots, assessments and authoritative current debt", async () => {
  const tables: Record<string, Row[]> = fixture();
  tables.trips.push(...Array.from({ length: 25 }, (_, i) => ({ ...tables.trips[0], id: `older-${i}`,
    fare_amount: 0, commission_amount: i ? 0 : null, commission_pct: 12, driver_net_earnings: 0 })));
  tables.phase4_fee_assessments = [{ id: "assessment", trip_id: "a", assessed_at: start, fee_cents: 2000, driver_cents: 1300, moovu_cents: 700 }];
  tables.phase4_customer_liabilities = [{ assessment_id: "assessment", original_cents: 2000, open_cents: 2000, status: "OPEN" }];
  tables.phase4_driver_compensations = [{ assessment_id: "assessment", earned_cents: 1300, settled_cents: 0, status: "EARNED" }];
  tables.trip_cancellation_fees = [{ id: "projection", phase4_assessment_id: "assessment", fee_amount: 20 }];
  const mock = harness(tables);
  const first = (await mock.read("reports")).body;
  const second = (await mock.read("reports", undefined, 2)).body;
  const tomorrow = (await mock.read("reports", "2026-11-26")).body;
  assert.equal(first.trips.count, 29);
  assert.ok(first.trips.rows.some((row: Row) => row.commission_pct === 12 && row.fare_amount === 0));
  assert.equal(second.trips.rows.at(-1).id, "0");
  assert.ok(second.trips.rows.some((row: Row) => row.id === "a" && row.commission_pct === 7));
  assert.equal(first.overview.trips.gross, 196);
  assert.equal(first.overview.trips.commission, null);
  assert.equal(first.overview.trips.net, 160);
  assert.equal(first.overview.direct.value, 4);
  assert.equal(first.overview.online.total, 12);
  assert.equal(first.overview.outstandingPayout, null);
  assert.deepEqual(first.overview.trips, second.overview.trips);
  assert.equal(tomorrow.overview.trips.gross, 80);
  assert.deepEqual(tomorrow.overview.debt, first.overview.debt);
  assert.deepEqual(first.cancellationSummary, { complete: true, assessed: 20, driverShare: 13, platformShare: 7, collected: null, paid: null });
  assert.equal(first.cancellations.rows[0].trip_id, "a");
  assert.equal(first.cancellations.rows[0].liability.open_cents, 2000);
  assert.equal(first.cancellations.rows[0].compensation.earned_cents, 1300);
  const unavailable = (await harness(tables, { fail: "phase4_fee_assessments" }).read("reports")).body;
  assert.equal(unavailable.cancellationSummary.assessed, null);
  assert.equal(unavailable.cancellations, null);
  assert.equal(unavailable.overview.trips.gross, 196);
  const partial = (await harness(tables, { cap: 3 }).read("reports")).body;
  assert.equal(partial.overview.tripsComplete, false);
  assert.equal(partial.overview.trips, null);
  assert.equal(partial.trips.count, 29);
  assert.equal((await harness(tables, { role: "support" }).read("reports")).status, 403);
});

test("financial report navigation and retry use persisted trip IDs and report context", () => {
  const source = readFileSync(new URL("../../app/admin/(protected)/reports/page.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("/admin/trips/${row.id}"));
  assert.ok(source.includes("/admin/trips/${row.trip_id}"));
  assert.match(source, /useFinancialRead\(query, read\)/);
  assert.match(source, /onClick=\{report.retry\}/);
  assert.match(source, /historicalPage: String\(historicalPage\), historicalDates/);
  assert.match(source, /count=\{data.historical.count\} change=\{setHistoricalPage\}/);
});

test("historical cancellations page independently, exclude linked projections and preserve Phase 4 totals", async () => {
  const tables: Record<string, Row[]> = fixture();
  tables.phase4_fee_assessments = [{ id: "assessment", trip_id: "a", assessed_at: start, fee_cents: 2000, driver_cents: 1300, moovu_cents: 700 }];
  tables.phase4_customer_liabilities = [];
  tables.phase4_driver_compensations = [];
  const history = { trip_id: "historical-trip", phase4_assessment_id: null, created_at: start, fee_amount: 50, driver_amount: 30, moovu_amount: 20 };
  tables.trips.push({ id: "historical-trip", status: "cancelled" });
  tables.trip_cancellation_fees = [
    ...Array.from({ length: 27 }, (_, i) => ({ ...history, id: String(i).padStart(2, "0") })),
    { ...history, id: "linked", trip_id: "a", phase4_assessment_id: "assessment" },
    { ...history, id: "undated", created_at: null },
    { ...history, id: "prior", created_at: "2026-11-24T21:59:59.999Z" },
    { ...history, id: "next", created_at: end },
  ];
  const read = (mock: ReturnType<typeof harness>, extra = "") => mock.read("reports", undefined, 1, undefined, undefined, extra);
  const mock = harness(tables);
  const first = (await read(mock)).body;
  const second = (await read(mock, "historicalPage=2")).body;
  assert.equal(first.historical.count, 27);
  assert.equal(first.historical.rows[0].id, "26");
  assert.deepEqual(second.historical.rows.map((row: Row) => row.id), ["01", "00"]);
  assert.equal(second.historical.rows[0].trip_id, "historical-trip");
  assert.equal(second.historical.rows[0].trip_status, "cancelled");
  assert.equal(second.historical.rows[0].driver_amount, 30);
  assert.equal(second.historical.rows[0].moovu_amount, 20);
  assert.deepEqual(first.cancellationSummary, { complete: true, assessed: 20, driverShare: 13, platformShare: 7, collected: null, paid: null });
  assert.deepEqual(second.cancellationSummary, first.cancellationSummary);
  assert.deepEqual(second.overview.trips, first.overview.trips);
  const undated = (await read(mock, "historicalDates=unavailable")).body.historical;
  assert.equal(undated.count, 1);
  assert.equal(undated.rows[0].created_at, null);
  const uncertain = (await read(harness(tables, { legacySchema: true }))).body;
  assert.equal(uncertain.historical.relationship, "unverified");
  assert.deepEqual(uncertain.cancellationSummary, first.cancellationSummary);
  const failed = (await read(harness(tables, { fail: "trip_cancellation_fees" }))).body;
  assert.equal(failed.historical, null);
  assert.deepEqual(failed.cancellationSummary, first.cancellationSummary);
  const failedPhase4 = (await read(harness(tables, { fail: "phase4_fee_assessments" }))).body;
  assert.equal(failedPhase4.historical.count, 27);
  const empty = (await read(harness({ ...tables, trip_cancellation_fees: [] }))).body.historical;
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.count, 0);
  assert.equal((await read(harness(tables, { role: "support" }))).status, 403);
});

test("actual Yoco queue and operational counts share unique verified exception classification", async () => {
  const tables: Record<string, Row[]> = fixture();
  tables.phase6_applications = [];
  tables.driver_payment_requests = [{ status: "pending_payment_review", payment_type: "combined" }];
  tables.trips.push(...[
    ["accepted", "assigned", "accepted"], ["pending", "offered", "pending"],
    ["cancelled", "cancelled", "accepted"], ["completed", "completed", "accepted"], ["ongoing", "ongoing", "accepted"],
  ].map(([id, status, offer_status]) => ({ id, status, offer_status })));
  const base = { provider: "YOCO", customer_id: "customer", state: "SUCCEEDED", currency: "ZAR", amount_cents: 4900,
    verified_at: "2025-09-01T00:00:00Z", reconciliation_state: "PENDING", dispatch_state: "DISPATCHED" };
  tables.online_payment_attempts = [
    ["a", null, "DISPATCHED"], ["b", "pending", "DISPATCHED"], ["c", "pending", "DEFERRED"],
    ["d", "pending", "FAILED"], ["e", "cancelled", "DISPATCHED"], ["f", "completed", "FAILED"],
    ["g", "ongoing", "DISPATCHED"], ["h", "accepted", "DISPATCHED"], ["i", "pending", null],
    ["j", "pending", "FAILED"],
  ].map(([id, trip_id, dispatch_state]) => ({ ...base, id, trip_id, dispatch_state, provider_payment_id: id === "j" ? "d" : id }));
  tables.online_payment_attempts.push({ ...base, id: "pending-attempt", state: "PENDING", provider_payment_id: null },
    { ...base, id: "failed-attempt", state: "FAILED" });
  tables.online_provider_events = tables.online_payment_attempts.filter((row) => row.id !== "h")
    .map((row) => ({ payment_attempt_id: row.id, provider: "YOCO", trust_state: "VERIFIED", processing_state: "PROCESSED", raw_provider_status: "succeeded" }));
  tables.online_payment_reconciliation_items = [{ id: "issue", payment_attempt_id: "j", state: "OPEN", issue_type: "AMOUNT_MISMATCH" }];
  tables.online_payment_refunds = [{ id: "refund", payment_attempt_id: "e", state: "REFUND_PENDING", provider: "YOCO" }];
  const read = (mock: ReturnType<typeof harness>, extra = "") => mock.read("online-payments", undefined, 1, undefined, undefined, `view=fulfilment&${extra}`);
  const mock = harness(tables);
  const all = (await read(mock, "fulfilment=all")).body;
  const byId = new Map<string, Row>(all.rows.map((row: Row) => [row.id, row]));
  assert.equal(byId.get("a")?.primary, "missing_trip");
  assert.equal(byId.get("b")?.primary, "awaiting_acceptance");
  assert.equal(byId.get("c")?.primary, "deferred");
  assert.equal(byId.get("j")?.primary, "reconciliation");
  assert.deepEqual(byId.get("j")?.reasons, ["reconciliation", "dispatch_failed", "awaiting_acceptance"]);
  assert.equal(byId.get("d"), undefined);
  assert.equal(byId.get("e")?.primary, "cancelled");
  assert.equal(byId.get("e")?.trip_id, "cancelled");
  assert.equal(byId.get("f")?.primary, "normal");
  assert.equal(byId.get("g")?.primary, "normal");
  assert.equal(byId.get("h")?.verified, null);
  assert.equal(byId.get("i")?.primary, "unavailable");
  assert.equal(byId.get("pending-attempt")?.verified, false);
  assert.equal(byId.get("failed-attempt")?.verified, false);
  const queue = (await read(mock)).body;
  assert.equal(queue.retrieved, 4);
  assert.equal(queue.total, null);
  assert.equal((await mock.read("operational-counts")).body.yocoTripPaymentExceptions, null);
  tables.online_payment_attempts = tables.online_payment_attempts.filter((row) => row.id !== "h" && row.id !== "i");
  const complete = harness(tables);
  assert.equal((await read(complete)).body.total, 4);
  const counts = (await complete.read("operational-counts")).body;
  assert.equal(counts.yocoTripPaymentExceptions, 4);
  assert.equal(counts.paymentQueues.pendingProofs, 1);
  assert.equal(counts.paymentQueues.commissionProofs, 1);
  assert.equal(counts.paymentQueues.subscriptionProofs, 1);
  assert.equal((await read(complete, "fulfilment=dispatch_failed&state=SUCCEEDED")).body.total, 1);
  assert.equal((await read(harness(tables, { cap: 2 }))).body.complete, false);
  assert.equal((await read(harness(tables, { fail: "online_payment_attempts" }))).status, 503);
  assert.equal((await read(harness(tables, { fail: "trips" }), "fulfilment=all")).body.rows.find((row: Row) => row.id === "f").tripEvidence, "unavailable");
  assert.equal((await read(harness(tables, { fail: "online_payment_reconciliation_items" }))).body.total, null);
  assert.equal((await read(harness(tables, { role: "support" }))).status, 403);

  for (let i = 0; i < 26; i++) {
    const id = `history-${String(i).padStart(2, "0")}`;
    tables.online_payment_attempts.push({ ...base, id, trip_id: null, provider_payment_id: id });
    tables.online_provider_events.push({ ...tables.online_provider_events[0], payment_attempt_id: id });
  }
  const paged = harness(tables);
  const first = (await read(paged)).body;
  const second = (await paged.read("online-payments", undefined, 2, undefined, undefined, "view=fulfilment")).body;
  assert.equal(first.rows.length, 25);
  assert.equal(second.rows.length, 5);
  assert.equal(second.total, first.total);
  assert.ok(second.rows.some((row: Row) => row.id === "a"));
});

test("Yoco exception client uses keyed requests, retry and stored canonical trip IDs", () => {
  const source = readFileSync(new URL("../../components/finance/YocoFulfilmentQueue.tsx", import.meta.url), "utf8");
  assert.match(source, /useFinancialRead\(key, read\)/);
  assert.match(source, /onClick=\{queue.retry\}/);
  assert.ok(source.includes("/admin/trips/${row.trip_id}"));
});

test("Admin and Driver payout GETs share verified inputs, reject cross-driver access and never post recovery", async () => {
  const tables: Record<string, Row[]> = fixture();
  tables.trips = [
    { ...trip, ride_option: "go", phase5_ride_fare_cents: 4600, phase5_service_fee_cents: 300, phase5_customer_total_cents: 4900 },
    { ...trip, id: "unverified", ride_option: "go" },
    { ...trip, id: "historical", ride_option: "go" },
    { ...trip, id: "other-driver", driver_id: "other" },
  ];
  tables.online_payment_attempts = ["a", "historical"].map((id) => ({ id, trip_id: id, provider: "YOCO", state: "SUCCEEDED",
    currency: "ZAR", amount_cents: 4900, verified_at: start, provider_payment_id: id }));
  tables.online_provider_events = ["a", "historical"].map((id) => ({ id, payment_attempt_id: id,
    provider: "YOCO", trust_state: "VERIFIED", processing_state: "PROCESSED", raw_provider_status: "succeeded" }));
  const mock = harness(tables, { payoutDebt: 6.9 });
  const read = (route: string, extra = "", h = mock) => h.read(route, undefined, 1, undefined, undefined, extra);
  const admin = (await read("payout-estimates", "driverId=d")).body;
  const driver = (await read("driver/payout-estimates")).body;
  assert.deepEqual(admin, driver);
  assert.equal(admin.total, 3);
  assert.equal(admin.currentDebtCents, 690);
  const byId = new Map<string, Row>(admin.rows.map((row: Row) => [row.tripId, row]));
  assert.deepEqual(byId.get("a")?.estimate, { customerPaymentCents: 4900, fareCents: 4600,
    driverBookingShareCents: 100, percentageFeeCents: 86, fixedFeeCents: 200, grossCents: 4414,
    recoveryCents: 690, netCents: 3724, remainingCents: 0, requiresReview: false });
  assert.equal(byId.get("historical")?.estimate, null);
  assert.equal(byId.get("unverified")?.estimate, null);
  assert.equal(admin.confirmedAllocation, null);
  assert.equal(admin.manualPayment, null);
  assert.equal(admin.bankVerification, null);
  assert.ok(mock.calls.every((call) => call.name === "phase05b_driver_debt" && call.args.p_driver_id === "d"));
  assert.equal((await read("driver/payout-estimates", "driverId=other")).status, 403);
  assert.equal((await read("payout-estimates", "driverId=d", harness(tables, { role: "support" }))).status, 403);
  const unavailable = (await read("driver/payout-estimates", "", harness(tables, { fail: "debt" }))).body;
  assert.equal(unavailable.currentDebtCents, null);
  assert.ok(unavailable.rows.every((row: Row) => row.estimate === null));
  const zero = (await read("driver/payout-estimates", "", harness(tables, { payoutDebt: 0 }))).body;
  assert.equal(zero.currentDebtCents, 0);
  assert.equal(zero.rows.find((row: Row) => row.tripId === "a").estimate.netCents, 4414);
});

test("both financial interfaces use the same payout panel and keyed request lifecycle", () => {
  for (const path of ["admin/(protected)/drivers/[id]/page.tsx", "driver/earnings/page.tsx"]) {
    assert.match(readFileSync(new URL(`../../app/${path}`, import.meta.url), "utf8"), /<CommissionFirstEstimates/);
  }
  const panel = readFileSync(new URL("../../components/finance/CommissionFirstEstimates.tsx", import.meta.url), "utf8");
  assert.match(panel, /useFinancialRead\(key, read\)/);
  assert.match(panel, /onClick=\{report.retry\}/);
});

test("financial GET routes reject unauthenticated and operational roles before financial reads", async () => {
  for (const path of ["earnings", "reports", "reports/driver-earnings", "settlements", "driver-wallet-summary",
    "payment-reviews", "subscriptions/receipts", "phase5-memberships", "online-payments", "payout-estimates"]) {
    for (const [options, status] of [[{ unauthenticated: true }, 401], [{ role: "support" }, 403], [{ role: "dispatcher" }, 403]] as const) {
      const mock = harness({}, options);
      assert.equal((await mock.read(path)).status, status, path);
      assert.equal(mock.calls.length, 0);
    }
  }
  const tables: Record<string, Row[]> = { driver_payment_requests: [{ status: "pending_payment_review", payment_type: "combined" }],
    phase6_applications: [], online_payment_attempts: [] };
  const operational = (await harness(tables, { role: "dispatcher" }).read("operational-counts")).body;
  assert.equal(operational.paymentQueues.pendingProofs, 1);
  assert.equal(operational.yocoTripPaymentExceptions, 0);
  assert.equal((await harness(fixture(), { role: "owner" }).read("subscriptions/receipts")).status, 200);
});

test("financial mutations reject operational roles before invoking existing write contracts", async () => {
  for (const path of ["payment-reviews", "settlements/record", "subscriptions/expire", "phase4-finance", "phase5-memberships",
    "subscriptions/update", "driver-subscription-activate", "driver-subscription-payments"]) {
    for (const role of ["support", "dispatcher"]) {
      const mock = harness({}, { role });
      assert.equal((await mock.read(path, undefined, 1, "all", undefined, "", "POST")).status, 403, path);
      assert.equal(mock.calls.length, 0);
    }
  }
});

test("driver payout GET fails closed when the authenticated account is not linked", async () => {
  const mock = harness({}, { missingDriver: true });
  assert.equal((await mock.read("driver/payout-estimates")).status, 404);
  assert.equal(mock.calls.length, 0);
});

test("corrected financial clients use context-keyed read state and exact retry", () => {
  for (const file of ["admin/(protected)/online-payments/page.tsx", "admin/(protected)/settlements/page.tsx", "driver/earnings/page.tsx"]) {
    const source = readFileSync(new URL(`../../app/${file}`, import.meta.url), "utf8");
    assert.match(source, /useFinancialRead\(/);
    assert.match(source, /onClick=\{(?:report\.)?retry\}/);
  }
  const route = readFileSync(new URL("../../app/api/driver/earnings/route.ts", import.meta.url), "utf8");
  assert.match(route, /readCommissionDebt\(/);
  assert.doesNotMatch(route, /recalculateDriverWalletServer|phase05b_refresh_driver_wallet/);
});

test("actual Driver Earnings GET enforces ownership and uses only read-only commission debt", async () => {
  const tables: Record<string, Row[]> = {
    drivers: [{ id: "d" }], driver_accounts: [{ driver_id: "d", user_id: "driver-user" }], driver_wallets: [],
    driver_settlements: [], driver_subscription_payments: [], driver_payment_requests: [], trips: [],
    driver_wallet_transactions: [], trip_cancellation_fees: [],
  };
  const mock = harness(tables, { payoutDebt: 0 });
  const own = await mock.read("driver/earnings", undefined, 1, undefined, undefined, "driverId=d");
  assert.equal(own.status, 200);
  assert.equal(own.body.earnings.wallet.balance_due, 0);
  assert.deepEqual(mock.calls.map((call) => call.name), ["phase05b_driver_debt"]);
  assert.equal((await mock.read("driver/earnings", undefined, 1, undefined, undefined, "driverId=other")).status, 403);
  assert.equal((await harness({ ...tables, driver_accounts: [] }).read("driver/earnings")).status, 404);
  assert.equal((await harness(tables, { fail: "debt" }).read("driver/earnings")).status, 503);
  assert.equal((await harness(tables, { unauthenticated: true }).read("driver/earnings")).status, 401);
  const partial = (await harness(tables, { fail: "trip_cancellation_fees" }).read("driver/earnings")).body.earnings;
  assert.equal(partial.wallet.balance_due, 62);
  assert.equal(partial.cancellation_unavailable, true);
  assert.equal(partial.cancellation_driver_earnings, null);
});
