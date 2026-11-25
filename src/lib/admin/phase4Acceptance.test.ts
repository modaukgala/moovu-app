import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const { archiveQuery, archiveRequest, driverArchiveHref } = await import(new URL("./archiveContext.ts", import.meta.url).href) as typeof import("./archiveContext");
const { readPaymentReceipt } = await import(new URL("./paymentReceiptRead.ts", import.meta.url).href) as typeof import("./paymentReceiptRead");
const { createCommissionHistoryRequest } = await import(new URL("./commissionHistoryRequest.ts", import.meta.url).href) as typeof import("./commissionHistoryRequest");

test("driver-name handoff and archive requests decode once and preserve selected filters", () => {
  const names = ["Thabo Modau", "D'Arcy & Sons + 50% %26", "Môre / Ndlovu"];
  for (const name of [...names, names[0], ""]) {
    const link = new URL(driverArchiveHref(name), "http://local.invalid");
    assert.equal(link.pathname, "/admin/archive");
    const q = archiveQuery(link.searchParams);
    assert.equal(q, name);
    const request = new URL(archiveRequest({ q, status: "completed", dateFrom: "2026-11-01", dateTo: "2026-11-25", page: 1 }), link);
    assert.equal(request.searchParams.get("q") ?? "", name);
    assert.equal(request.searchParams.get("page"), "1");
    assert.equal(request.searchParams.get("status"), "completed");
    assert.equal(request.searchParams.get("dateFrom"), "2026-11-01");
    assert.equal(request.searchParams.get("dateTo"), "2026-11-25");
  }
});

const receipt = { id: "original", driver_id: "driver", driver_name: "Driver", payment_type: "combined",
  status: "approved", amount_submitted: null, allocation: { commission: 60, subscription: null, excess: 20 } };
const response = (body: unknown, status = 200) => async () => Response.json(body, { status });
const signal = new AbortController().signal;

test("receipt response distinguishes missing, access failures, malformed and unavailable data", async () => {
  assert.equal(await readPaymentReceipt("original", "token", signal, response({ ok: false, error: "Receipt not found." }, 404)), null);
  for (const [read, error] of [
    [response({}, 401), /Sign in/],
    [response({}, 403), /Financial Admin/],
    [response({}, 500), /retrieval failed/],
    [response({}, 404), /retrieval failed/],
    [async () => new Response("{"), /retrieval failed/],
    [response({ ok: true, receipt: { id: "original", status: "approved" } }), /retrieval failed/],
    [response({ ok: true, receipt: { ...receipt, id: "other" } }), /retrieval failed/],
    [async () => { throw new Error("network unavailable"); }, /network unavailable/],
  ] as const) await assert.rejects(readPaymentReceipt("original", "token", signal, read), error);

  const loaded = await readPaymentReceipt("original", "token", signal, response({ ok: true, receipt }));
  assert.equal(loaded.amount_submitted, null);
  assert.deepEqual(loaded.allocation, receipt.allocation);
});

test("receipt timeout settles loading, retry retains ID, and superseded navigation cannot publish", async () => {
  const request = createCommissionHistoryRequest<string, unknown>(20);
  const states: { loading: boolean; result?: unknown; error?: string }[] = [];
  const publish = (state: typeof states[number]) => states.push(state);
  await request.run("original", (id, signal) => readPaymentReceipt(id, "token", signal, () => new Promise(() => {})), publish);
  assert.equal(states.at(-1)?.loading, false);
  assert.match(states.at(-1)?.error ?? "", /timed out/);
  const retry = request.failedRequest();
  assert.equal(retry, "original");
  await request.run(retry, (id, signal) => readPaymentReceipt(id, "token", signal, async (url) => {
    assert.equal(url, "/api/admin/payment-reviews?id=original");
    return Response.json({ ok: true, receipt });
  }), publish);
  assert.deepEqual(states.at(-1)?.result, receipt);
  const older = request.run("original", (id, signal) => readPaymentReceipt(id, "token", signal,
    () => new Promise(resolve => setTimeout(() => resolve(Response.json({ ok: true, receipt })), 25))), publish);
  await request.run("new", (id, signal) => readPaymentReceipt(id, "token", signal,
    response({ ok: true, receipt: { ...receipt, id: "new" } })), publish);
  await older;
  assert.deepEqual(states.at(-1)?.result, { ...receipt, id: "new" });
});

const dashboard = await import(new URL("./dashboardCards.ts", import.meta.url).href) as typeof import("./dashboardCards");
const navigation = await import(new URL("./resultNavigation.ts", import.meta.url).href) as typeof import("./resultNavigation");

test("dashboard uses each queue count once and preserves zero, unavailable and restricted visibility", () => {
  const inputs = { pending: 0, subscription: 3, commission: 5, waiting: 9, yocoExceptions: null, applications: 4 };
  const cards = dashboard.dashboardQueueCards(true, inputs);
  assert.deepEqual(cards.map(({ field, value }) => [field, value]), [
    ["pending","0"], ["subscription","3"], ["commission","5"], ["waiting","9"], ["yocoExceptions","Unavailable"], ["applications","4"],
  ]);
  assert.equal(cards.filter(card => card.field === "applications").length, 1);
  assert.equal(cards.find(card => card.field === "waiting")?.href, "/admin/payment-reviews?status=waiting_confirmation");
  assert.equal(cards.find(card => card.field === "yocoExceptions")?.href, "/admin/online-payments#fulfilment");
  assert.ok(cards.filter(card => ["subscription","commission"].includes(card.field)).every(card => card.href.endsWith("?status=pending_payment_review")));
  assert.deepEqual(dashboard.dashboardQueueCards(false, inputs), []);
  assert.equal(dashboard.countValue(undefined), "Unavailable");
  const source = readFileSync(new URL("../../app/admin/(protected)/page.tsx", import.meta.url), "utf8");
  assert.ok(source.indexOf("Requires attention") < source.indexOf("Weekly trips"));
  assert.match(source, /dashboardQueueCards\(financial,/);
  assert.match(source, /<ManualSurgeControl/);
  assert.match(source, /Africa\/Johannesburg/);
});

test("page bounds, per-queue pending state, and independent Board parameters", () => {
  assert.equal(navigation.pageTarget(1, -1, false, true), null);
  assert.equal(navigation.pageTarget(3, 1, false, false), null);
  assert.equal(navigation.pageTarget(2, -1, true, true), null);
  assert.equal(navigation.pageTarget(2, 1, true, true), null);
  assert.equal(navigation.pageTarget(2, 1, false, true), 3);
  const open = navigation.dispatchPageControls(2, 1, true, 200, 50);
  const closed = navigation.dispatchPageControls(4, 4, true, null, 50);
  assert.equal(open.busy, true);
  assert.deepEqual(closed, { busy:false, hasNext:true });
  assert.deepEqual(navigation.dispatchPageControls(4, 4, false, 200, 50), { busy:true, hasNext:false });
  assert.deepEqual(Object.fromEntries(navigation.dispatchBoardParams(2, 4, "A & B", "all", "unassigned")), {
    openPage:"2", closedPage:"4", q:"A & B", status:"all", queue:"unassigned",
  });
});
