import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
// @ts-expect-error Node strip-types requires the extension.
import { readCommissionDebt } from "./commissionDebt.ts";

type Row = Record<string, unknown>;
const rows = (count: number) => Array.from({ length: count }, (_, i) => ({
  id: String(i).padStart(3, "0"), driver_id: "driver", created_at: "2026-09-01", status: "completed", amount_paid: 2,
}));
const tables: Record<string, Row[]> = {
  drivers: [{ id: "driver", first_name: "Test" }], driver_wallets: [],
  driver_settlements: rows(240), trips: rows(125), driver_wallet_transactions: rows(130),
};

function route(path: string, debt: unknown) {
  const db = {
    from(table: string) {
      let data = [...tables[table]];
      let orders: [string, boolean][] = [];
      let offset = 0;
      let end = Infinity;
      let single = false;
      const query = {
        select: () => query,
        eq(key: string, value: unknown) { data = data.filter((row) => row[key] === value); return query; },
        in(key: string, values: unknown[]) { data = data.filter((row) => values.includes(row[key])); return query; },
        order(key: string, options?: { ascending: boolean }) { orders = [...orders, [key, options?.ascending !== false]]; return query; },
        limit(size: number) { end = size; return query; },
        range(from: number, to: number) { offset = from; end = to + 1; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve: (value: unknown) => void) {
          const page = data.sort((a, b) => {
            for (const [key, asc] of orders) {
              const cmp = String(a[key]).localeCompare(String(b[key]));
              if (cmp) return asc ? cmp : -cmp;
            }
            return 0;
          }).slice(offset, end);
          resolve({ data: single ? page[0] ?? null : page, count: data.length, error: null });
        },
      };
      return query;
    },
    async rpc(name: string, args: Row) {
      assert.equal(name, "phase05b_driver_debt");
      assert.equal(args.p_driver_id, "driver");
      return { data: debt, error: debt === null ? "unavailable" : null };
    },
  };
  const source = readFileSync(new URL(`../../app/api/admin/${path}/route.ts`, import.meta.url), "utf8");
  const exports: { GET?: (req: Request) => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: Response },
    "@/lib/auth/admin": { requireAdminUser: async () => ({ ok: true, profile: { role: "admin" }, supabaseAdmin: db }), isFinancialAdminRole: () => true },
    "@/lib/admin/commissionDebt": { readCommissionDebt },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, URL, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
  });
  return (query: string) => exports.GET!(new Request(`https://local.invalid/?driverId=driver&${query}`));
}

test("actual GET handlers share complete debt across independent history pages", async () => {
  const debt = { driver_id: "driver", balance_due: 740, total_commission: 1250,
    total_driver_net: 5000, total_trips_completed: 125, total_settled: 480, cancellation_credits: 30 };
  const wallet = route("driver-wallet-summary", debt);
  const settlements = route("settlements", debt);
  const first = await (await wallet("")).json();
  assert.equal(first.wallet.balance_due, 740);
  for (const [parameter, page, key, totalKey, total, oldest] of [
    ["transactionPage", 7, "transactions", "transactionTotal", 130, "000"],
    ["tripPage", 7, "recent_completed_trips", "tripTotal", 125, "000"],
    ["settlementPage", 12, "settlements", "settlementTotal", 240, "000"],
  ] as const) {
    const older = await (await wallet(`${parameter}=${page}`)).json();
    assert.equal(older.wallet.balance_due, first.wallet.balance_due);
    assert.equal(older.wallet.cancellation_credits, 30);
    assert.equal(older.pagination[totalKey], total);
    assert.equal(older[key].at(-1).id, oldest);
    assert.ok(first[key][0].id > older[key][0].id);
  }
  for (const page of [1, 5]) {
    const report = await (await settlements(`settlementPage=${page}`)).json();
    assert.equal(report.drivers[0].wallet_summary.balance_due, first.wallet.balance_due);
    assert.equal(report.settlementPagination.total, 240);
    assert.equal(report.settlements.at(-1).id, page === 1 ? "190" : "000");
  }
});

test("both GET handlers reject failed and malformed debt", async () => {
  for (const path of ["driver-wallet-summary", "settlements"]) {
    for (const debt of [null, { driver_id: "driver", balance_due: null }]) {
      const result = await route(path, debt)("");
      assert.ok(result.status >= 500);
      assert.equal((await result.json()).ok, false);
    }
  }
});
