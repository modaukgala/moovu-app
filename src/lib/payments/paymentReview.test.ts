import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { parsePaymentReviewFilters } from "./paymentReview.ts";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("review filter parsing keeps date, state, search and page on the server", () => {
  const filters = parsePaymentReviewFilters(new URLSearchParams({
    from: "2026-10-01T00:00:00Z", to: "2026-10-10T00:00:00Z",
    status: "verified-paid", fulfilment: "no-trip", search: "reference", page: "2",
  }));
  assert.equal(filters.p_page, 2);
  assert.equal(filters.p_status, "verified-paid");
  assert.equal(filters.p_fulfilment, "no-trip");
  assert.equal(filters.p_search, "reference");
  assert.equal(filters.p_limit, 20);
  assert.throws(() => parsePaymentReviewFilters(new URLSearchParams({
    from: "2026-10-01", to: "2026-10-10", status: "paid-by-redirect",
  })));
});

test("review SQL filters the complete source before stable pagination", async () => {
  const sql = await read("supabase/migrations/20261013120000_admin_yoco_payment_review.sql");
  const filtered = sql.indexOf("filtered as materialized (");
  const pageRows = sql.indexOf("page_rows as (");
  assert.ok(filtered > 0 && pageRows > filtered);
  assert.match(sql, /select \* from filtered order by coalesce\(verified_at,created_at\) desc,id desc/);
  assert.match(sql, /'total',count\(\*\)/);
  assert.match(sql, /f\.fulfilment_status=p_fulfilment/);
  assert.match(sql, /'needs-review' and f\.fulfilment_status in \('no-trip','awaiting-driver','cancelled'\)/);
  assert.match(sql, /e\.trust_state='VERIFIED'/);
  assert.match(sql, /e\.processing_state='PROCESSED'/);
  assert.match(sql, /when s\.state in \('CREATED','PENDING'\) then 'pending'/);
  assert.match(sql, /when s\.state in \('FAILED','CANCELLED','EXPIRED'\) then 'failed'/);
  assert.match(sql, /s\.state in \('REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED','REFUND_FAILED'\) then 'refund-review'/);
  assert.match(sql, /c\.trip_id is null or c\.trip_status is null then 'no-trip'/);
  assert.match(sql, /c\.offer_status='accepted' then 'allocated'/);
  assert.match(sql, /revoke all on function public\.admin_yoco_payment_review[\s\S]*from public,anon,authenticated/);
  assert.match(sql, /grant execute on function public\.admin_yoco_payment_review[\s\S]*to service_role/);
});

test("forward-only review correction searches checkout references without changing review classification", async () => {
  const original = await read("supabase/migrations/20261013120000_admin_yoco_payment_review.sql");
  const corrected = await read("supabase/migrations/20261013120100_admin_yoco_review_checkout_search.sql");
  const checkoutSearch = "        or position(lower(trim(p_search)) in lower(coalesce(f.provider_checkout_id,'')))>0\n";
  assert.match(corrected, /coalesce\(f\.provider_checkout_id,''\)/);
  assert.equal(corrected.replace(checkoutSearch, "").slice(corrected.indexOf("create or replace function")),
    original.slice(original.indexOf("create or replace function")));
  assert.match(corrected, /order by coalesce\(verified_at,created_at\) desc,id desc/);
});

test("review filter contract preserves exact timestamp bounds and page selection", () => {
  const lower = "2026-09-22T07:01:54.453Z";
  const upper = "2026-09-23T07:01:54.453Z";
  const filters = parsePaymentReviewFilters(new URLSearchParams({
    from: lower, to: upper, search: "  checkout-ref  ", page: "2",
  }));
  assert.equal(filters.p_from, lower);
  assert.equal(filters.p_to, upper);
  assert.equal(filters.p_search, "checkout-ref");
  assert.equal(filters.p_page, 2);
  assert.throws(() => parsePaymentReviewFilters(new URLSearchParams({ from: upper, to: lower })));
});

test("review ordering source contract has an ID tie-break for equal timestamps", async () => {
  const sql = await read("supabase/migrations/20261013120100_admin_yoco_review_checkout_search.sql");
  assert.match(sql, /page_rows as \([\s\S]*?order by coalesce\(verified_at,created_at\) desc,id desc/);
  assert.match(sql, /jsonb_agg\(to_jsonb\(r\) order by coalesce\(r\.verified_at,r\.created_at\) desc,r\.id desc\)/);
});

test("payment review API enforces financial Admin and does not mutate payments or trips", async () => {
  const route = await read("src/app/api/admin/online-payment-reviews/route.ts");
  assert.match(route, /requireAdminUser\(req\)/);
  assert.match(route, /isFinancialAdminRole\(auth\.profile\.role\)/);
  assert.match(route, /rpc\("admin_yoco_payment_review", filters\)/);
  assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(/);
});

test("Admin commission pages use the same authority resolver and never present a partial aggregate", async () => {
  const route = await read("src/app/api/admin/commission-balances/route.ts");
  const detail = await read("src/app/api/admin/driver-wallet-summary/route.ts");
  const driver = await read("src/app/api/driver/earnings/route.ts");
  assert.match(route, /requireAdminUser\(req\)/);
  assert.match(route, /\.order\("id"\)\.range\(from, from \+ PAGE_SIZE - 1\)/);
  assert.match(route, /resolveDriverFinanceAuthority\(auth\.supabaseAdmin/);
  assert.match(route, /aggregate_outstanding_cents: null/);
  assert.match(detail, /resolveDriverFinanceAuthority\(supabaseAdmin/);
  assert.doesNotMatch(detail, /recalculateDriverWalletServer/);
  assert.match(driver, /resolveDriverFinanceAuthority\(supabaseAdmin/);
});

test("commission policy preserves 15 percent Phase 2 and historical legacy rates", async () => {
  const phase2 = await read("src/lib/finance/phase2Policy.ts");
  const legacy = await read("src/lib/finance/commission.ts");
  const completion = await read("docs/phase-5-atomic-operations.sql");
  assert.match(phase2, /PHASE2_COMMISSION_BASIS_POINTS = BigInt\(1500\)/);
  assert.match(legacy, /MOOVU_COMMISSION_PCT = 9\.5/);
  assert.match(completion, /then 12[\s\S]*then 10 else 9\.5 end/);
});
