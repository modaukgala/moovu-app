import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error Node strip-types requires explicit extensions.
import { createCommissionHistoryRequest } from "./commissionHistoryRequest.ts";

test("allocation surfaces, receipts and MOOVU+ wire the shared keyed request lifecycle", () => {
  for (const [page, key, retry] of [
    ["payment-reviews", /useFinancialRead\(`\$\{statusFilter\}:\$\{paymentTypeFilter\}`, read\)/, /onClick=\{retryAllocations\}/],
    ["commission-payments", /useFinancialRead\(String\(driverPage\), readAllocations\)/, /onClick=\{allocationRead.retry\}/],
    ["subscriptions", /useFinancialRead\(receiptQuery, readReceipts\)/, /onClick=\{receipts.retry\}/],
    ["moovu-plus", /useFinancialRead\(query, read\)/, /onClick=\{retry\}/],
  ] as const) {
    const source = readFileSync(new URL(`../../app/admin/(protected)/${page}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, key);
    assert.match(source, retry);
    if (page === "subscriptions") assert.match(source, /const allocationRead = useFinancialRead/);
    if (page === "moovu-plus") assert.match(source, /setStatus\(event.target.value\); setPage\(1\)/);
  }
  const hook = readFileSync(new URL("./useFinancialRead.ts", import.meta.url), "utf8");
  assert.match(hook, /saved\?\.key === key/);
  assert.match(hook, /if \(failed === key\) void run\(failed\)/);
  assert.match(hook, /request\.invalidate\(\)/);
});

test("financial request lifecycle retries exact pages and ignores superseded filter results", async () => {
  const request = createCommissionHistoryRequest<string, { receipts: number; active: number }>(10);
  const key = "page=2&status=APPROVED";
  let saved: { receipts: number; active: number } | undefined;
  let error: string | undefined;
  let loading = false;
  const publish = (state: { loading: boolean; error?: string; result?: typeof saved }) => {
    loading = state.loading;
    error = state.error;
    if (state.result) saved = state.result;
  };
  await request.run(key, async () => ({ receipts: 99, active: 5 }), publish);
  await request.run(key, () => new Promise(() => {}), publish);
  assert.equal(loading, false);
  assert.match(error ?? "", /timed out/);
  assert.deepEqual(saved, { receipts: 99, active: 5 });
  await request.run(request.failedRequest()!, async (input) => {
    assert.equal(input, key);
    return { receipts: 99, active: 5 };
  }, publish);
  assert.equal(error, undefined);
  let finish!: (result: NonNullable<typeof saved>) => void;
  const obsolete = request.run(key, () => new Promise((resolve) => { finish = resolve; }), publish);
  request.invalidate();
  await request.run("page=1&status=SUBMITTED", async () => ({ receipts: 101, active: 6 }), publish);
  finish({ receipts: 0, active: 0 });
  await obsolete;
  assert.deepEqual(saved, { receipts: 101, active: 6 });
  assert.equal(request.failedRequest(), undefined);
});
