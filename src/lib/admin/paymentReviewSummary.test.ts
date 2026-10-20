import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
// @ts-expect-error Node strip-types tests require the explicit extension.
import { adminPaymentReviewCounts } from "./paymentReviewCounts.ts";

type Review = { status: string; payment_type: string };

test("Dashboard summary matches the full queue without loading payment proofs", async () => {
  const rows: Review[] = [
    { status: "pending_payment_review", payment_type: "subscription" },
    { status: "waiting_confirmation", payment_type: "commission" },
    { status: "pending_payment_review", payment_type: "combined" },
    { status: "approved", payment_type: "commission" },
    { status: "rejected", payment_type: "subscription" },
  ];
  let countQueries = 0;
  const database = {
    from(table: string) {
      assert.equal(table, "driver_payment_requests");
      let filtered = rows;
      const query = {
        select(columns: string, options: { count: string; head: boolean }) {
          assert.equal(columns, "id");
          assert.equal(options.count, "exact");
          assert.equal(options.head, true);
          countQueries++;
          return query;
        },
        in(column: string, values: string[]) {
          filtered = filtered.filter(row => values.includes(row[column as keyof Review]));
          return query;
        },
        eq(column: string, value: string) {
          filtered = filtered.filter(row => row[column as keyof Review] === value);
          return query;
        },
        then(resolve: (result: { count: number; error: null }) => void) {
          resolve({ count: filtered.length, error: null });
        },
      };
      return query;
    },
  };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/auth/admin": { requireAdminUser: async () => ({ ok: true, supabaseAdmin: database }) },
    "@/lib/push-server": {},
    "@/lib/server/hardenedRpc": {},
    "@/lib/server/phase2Rpc": {},
    "@/lib/finance/phase2Policy": {},
    "@/lib/notifications/outboxDelivery": {},
    "@/lib/admin/identity": {},
  };
  const source = readFileSync(new URL("../../app/api/admin/payment-reviews/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
    URL,
    console,
  });
  const response = await exports.GET!(new Request("http://localhost/api/admin/payment-reviews?summary=1"));
  if (response.status !== 200) assert.fail(await response.text());
  const result = await response.json();
  assert.deepEqual(result.counts, adminPaymentReviewCounts(rows));
  assert.equal(countQueries, 4);
});
