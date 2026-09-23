import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error Node strip-types requires explicit extensions.
import { normalizeCustomerPaymentMethod } from "./customerPaymentMethod.ts";
// @ts-expect-error Node strip-types requires explicit extensions.
import { DRIVER_SUBSCRIPTION_PLANS } from "../finance/driverPayments.ts";

test("customer payment methods canonicalize only cash and online", () => {
  assert.equal(normalizeCustomerPaymentMethod(" CASH "), "cash");
  assert.equal(normalizeCustomerPaymentMethod("Online"), "online");
  assert.equal(normalizeCustomerPaymentMethod("eft"), null);
  assert.equal(normalizeCustomerPaymentMethod(null), null);
});

test("subscription plan prices remain server-owned exact amounts", () => {
  assert.deepEqual(DRIVER_SUBSCRIPTION_PLANS, {
    day: { label: "Daily", amount: 45, days: 1 },
    week: { label: "Weekly", amount: 100, days: 7 },
    month: { label: "Monthly", amount: 250, days: 30 },
  });
});

test("subscription migration separates authority and posts balanced deferred revenue", () => {
  const sql = readFileSync("docs/phase-3-payment-ux-subscription-yoco-correction.sql", "utf8");
  assert.match(sql, /driver_subscription_online_payment_attempts/);
  assert.match(sql, /driver_subscription_provider_events/);
  assert.match(sql, /phase3_process_trusted_subscription_payment_event/);
  assert.match(sql, /'SUBSCRIPTION_PAYMENT_CLEARING'/);
  assert.match(sql, /'DEFERRED_SUBSCRIPTION_REVENUE'/);
  assert.match(sql, /'DRIVER_SUBSCRIPTION_PAYMENT','DRIVER_SUBSCRIPTION_PAYMENT'/);
  assert.match(sql, /reconciliation_state='MATCHED'/);
  assert.match(sql, /auth\.role\(\) is distinct from 'service_role'/);
  assert.doesNotMatch(sql, /grant execute[^;]+to authenticated/i);
});

test("manual payment write endpoints fail closed", () => {
  const driverRoute = readFileSync("src/app/api/driver/payment-request/route.ts", "utf8");
  const customerRoute = readFileSync("src/app/api/customer/phase5-account/route.ts", "utf8");
  assert.match(driverRoute, /status: 410/);
  assert.match(customerRoute, /Manual bank-transfer membership submissions are no longer accepted/);
});

test("online trip method repair is service-only and cannot alter dispatched trips", () => {
  const sql = readFileSync("supabase/migrations/20260923103000_phase3_online_trip_method_repair.sql", "utf8");
  assert.match(sql, /phase3_mark_trip_online_before_dispatch/);
  assert.match(sql, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(sql, /Trip already entered dispatch/);
  assert.match(sql, /grant execute[^;]+to service_role/i);
  assert.doesNotMatch(sql, /grant execute[^;]+to (?:anon|authenticated)/i);
});

test("native hosted checkout falls back without exposing a Browser plugin failure", () => {
  const navigation = readFileSync("src/lib/payments/checkoutNavigation.ts", "utf8");
  assert.match(navigation, /try\s*\{/);
  assert.match(navigation, /catch \(error\)/);
  assert.match(navigation, /window\.location\.assign/);
});
