import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { PHASE1_LEDGER_READ_ENABLED, PHASE1_LEDGER_WRITE_ENABLED } from "./ledgerFoundation.ts";

const migration = readFileSync(new URL("../../../docs/phase-1-ledger-migration.sql", import.meta.url), "utf8");
const reconciliation = readFileSync(new URL("../../../docs/phase-1-ledger-reconciliation.sql", import.meta.url), "utf8");
const validation = readFileSync(new URL("../../../docs/phase-1-ledger-validation.sql", import.meta.url), "utf8");

test("Stage A remains disabled and the migration defines immutable double-entry contracts", () => {
  assert.equal(PHASE1_LEDGER_WRITE_ENABLED, false);
  assert.equal(PHASE1_LEDGER_READ_ENABLED, false);
  for (const table of ["financial_accounts", "financial_transactions", "financial_ledger_entries"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /amount_cents bigint not null check \(amount_cents > 0\)/);
  assert.match(migration, /create constraint trigger phase1_assert_financial_transaction_balanced_trigger/);
  assert.match(migration, /financial_transactions_one_terminal_trip_outcome_uidx/);
  assert.match(migration, /perform 1 from public\.trips where id=v_economic_trip_id for update/);
  assert.match(migration, /Incompatible terminal financial outcome already exists for trip/);
  assert.match(migration, /revoke all on public\.financial_accounts,public\.financial_transactions,public\.financial_ledger_entries/);
  assert.match(migration, /grant execute on function public\.phase1_post_financial_transaction/);
  assert.match(migration, /to service_role/);
});

test("reconciliation is read-only and documents authoritative source precedence", () => {
  assert.match(reconciliation, /READ ONLY \/ TEST FIXTURE \/ NOT FOR AUTOMATIC EXECUTION/);
  assert.doesNotMatch(reconciliation, /\b(insert|update|delete|alter|drop|truncate|create)\b/i);
  for (const source of ["trips", "driver_settlements", "driver_subscription_payments", "trip_cancellation_fees"]) {
    assert.match(reconciliation, new RegExp(source));
  }
  assert.match(reconciliation, /driver_payment_requests and cached driver_wallets are never independent money/);
});

test("validation is disposable-only, checks privileges and always rolls back", () => {
  assert.match(validation, /DISPOSABLE DATABASE ONLY/);
  assert.match(validation, /has_table_privilege\('anon'/);
  assert.match(validation, /has_function_privilege\('authenticated'/);
  assert.match(validation, /concurrent identical posts yield one transaction/);
  assert.match(validation, /rollback;\s*$/i);
});
