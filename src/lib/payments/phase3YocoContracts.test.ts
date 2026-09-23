import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("docs/phase-3-yoco-driver-online-payments.sql", "utf8");
const repeatPaymentCorrection = readFileSync("docs/phase-3-yoco-driver-repeat-payment-correction.sql", "utf8");
const webhook = readFileSync("src/app/api/payments/yoco/webhook/route.ts", "utf8");
const customerCheckout = readFileSync("src/app/api/payments/yoco/checkout/route.ts", "utf8");
const driverCheckout = readFileSync("src/app/api/payments/yoco/driver/checkout/route.ts", "utf8");

test("driver processor is service-only, exact-obligation, balanced and replay-keyed", () => {
  assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(migration, /v_current_net<>v_attempt\.amount_cents/);
  assert.match(migration, /'OBLIGATION_CHANGED'/);
  assert.match(migration, /'entry_side','DEBIT','amount_cents',v_attempt\.amount_cents/);
  assert.match(migration, /'entry_side','CREDIT','amount_cents',v_attempt\.amount_cents/);
  assert.match(migration, /'driver_online_payment:'\|\|v_attempt\.id::text/);
  assert.match(repeatPaymentCorrection, /drop index if exists public\.driver_online_payment_attempts_active_uidx/);
  assert.match(repeatPaymentCorrection, /where state in \('CREATED', 'PENDING', 'RECONCILIATION_REQUIRED'\)/);
  assert.doesNotMatch(repeatPaymentCorrection, /where state in \([^\n]*'SUCCEEDED'/);
  assert.match(migration, /revoke all on function public\.phase3_process_trusted_driver_payment_event/);
  assert.match(migration, /grant execute on function public\.phase3_process_trusted_driver_payment_event[\s\S]*to service_role/);
});

test("checkout amounts come from server authority and redirect cannot post success", () => {
  assert.match(customerCheckout, /\.select\("id, customer_id, payment_method, fare_amount, status"\)/);
  assert.doesNotMatch(customerCheckout, /body\.amount/);
  assert.match(driverCheckout, /finance\.authority\.netOwedCents/);
  assert.doesNotMatch(driverCheckout, /body\.amount/);
  assert.doesNotMatch(driverCheckout, /\.in\("state", \[[^\n]*"SUCCEEDED"/);
  assert.match(webhook, /verifyYocoWebhookSignature/);
  assert.match(webhook, /phase3_process_trusted_driver_payment_event/);
  assert.match(webhook, /dispatchVerifiedOnlineTrip/);
});
