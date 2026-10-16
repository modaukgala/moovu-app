import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const { ADMISSION_CLOSED_CODE, isAdmissionClosed } = await import(
  new URL("./admission.ts", import.meta.url).href
) as typeof import("./admission");

const migration = readFileSync("supabase/migrations/20261012191510_production_admission_gate.sql", "utf8");
const source = (path: string) => readFileSync(path, "utf8");

test("maintenance error is distinct from other booking and payment failures", () => {
  assert.equal(isAdmissionClosed({ message: ADMISSION_CLOSED_CODE }), true);
  assert.equal(isAdmissionClosed({ message: "PHASE5_QUOTE_CHANGED" }), false);
  assert.equal(isAdmissionClosed(null), false);
});

test("database protects each new admission, including direct and privileged inserts", () => {
  for (const table of ["trips", "online_payment_attempts", "driver_online_payment_attempts"]) {
    assert.match(migration, new RegExp(`before insert on public\\.${table} for each row`));
  }
  assert.match(migration, /for share/i);
  assert.match(migration, /where singleton = true for update/i);
  assert.match(migration, /where state = 'CREATED'/g);
  assert.doesNotMatch(migration, /before update on public\.trips|before update on public\.online_payment_attempts/i);
});

test("state, audit and transition are private and owner-restricted", () => {
  assert.match(migration, /alter table public\.moovu_admission_state enable row level security/i);
  assert.match(migration, /alter table public\.moovu_admission_audit enable row level security/i);
  assert.match(migration, /role = 'owner'/i);
  assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/i);
  assert.match(migration, /revoke all on function public\.moovu_admission_insert_guard\(\)/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(source("src/app/api/admin/maintenance-admission/route.ts"), /auth\.profile\.role !== "owner"/);
});

test("application maps rejected inserts without changing verified webhook handling", () => {
  for (const path of [
    "src/app/api/customer/book-trip/route.ts",
    "src/app/api/admin/trips/create/route.ts",
    "src/app/api/payments/yoco/checkout/route.ts",
    "src/app/api/payments/yoco/driver/checkout/route.ts",
  ]) {
    assert.match(source(path), /isAdmissionClosed\(/, path);
  }
  assert.doesNotMatch(source("src/app/api/payments/yoco/webhook/route.ts"), /moovu_admission|ADMISSION_CLOSED/);
});

test("non-Owner Admin cannot transition admission even with an authenticated session", async () => {
  let calls = 0;
  const route = ts.transpileModule(source("src/app/api/admin/maintenance-admission/route.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { POST?: (request: { json: () => Promise<unknown> }) => Promise<{ status: number }> } = {};
  vm.runInNewContext(route, { exports, require: (name: string) => {
    if (name === "next/server") return { NextResponse: { json: (_body: unknown, options?: { status?: number }) =>
      ({ status: options?.status ?? 200 }) } };
    if (name === "@/lib/auth/admin") return { requireAdminUser: async () => ({
      ok: true, profile: { role: "dispatcher" }, user: { id: "synthetic" },
      supabaseAdmin: { rpc: () => { calls++; } },
    }) };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const response = await exports.POST!({ json: async () => ({ target: "MAINTENANCE", reason: "Controlled window" }) });
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});
