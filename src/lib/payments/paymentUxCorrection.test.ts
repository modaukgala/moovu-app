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
  const sql = readFileSync("supabase/migrations/20260923195500_p0_online_payment_recovery.sql", "utf8");
  const booking = readFileSync("src/app/api/customer/book-trip/route.ts", "utf8");
  assert.match(sql, /phase3_mark_trip_online_before_dispatch/);
  assert.match(sql, /phase5_create_online_trip/);
  assert.match(sql, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(sql, /Trip already entered dispatch/);
  assert.doesNotMatch(sql, /set payment_method='online',\s*updated_at=/);
  assert.match(sql, /grant execute[^;]+to service_role/i);
  assert.doesNotMatch(sql, /grant execute[^;]+to (?:anon|authenticated)/i);
  assert.match(booking, /paymentMethod === "online"[\s\S]*"phase5_create_online_trip"/);
  assert.doesNotMatch(booking, /online payment method correction failed/);
});

test("webhook only queries installed Customer and Driver payment authorities", () => {
  const webhook = readFileSync("src/app/api/payments/yoco/webhook/route.ts", "utf8");
  assert.match(webhook, /online_payment_attempts/);
  assert.match(webhook, /driver_online_payment_attempts/);
  assert.doesNotMatch(webhook, /driver_subscription_online_payment_attempts/);
});

test("Driver reconciliation uses authenticated Yoco retrieval and deterministic replay identity", () => {
  const script = readFileSync("scripts/reconcile-yoco-driver-payment.mjs", "utf8");
  assert.match(script, /YOCO_AUTHENTICATED_CHECKOUT_RETRIEVAL/);
  assert.match(script, /checkout\.status !== "completed"/);
  assert.match(script, /checkout-retrieval:\$\{checkout\.paymentId\}/);
  assert.match(script, /phase3_process_trusted_driver_payment_event/);
  assert.doesNotMatch(script, /insert\([^)]*online_provider_events/);
});

test("native hosted checkout falls back without exposing a Browser plugin failure", () => {
  const navigation = readFileSync("src/lib/payments/checkoutNavigation.ts", "utf8");
  assert.match(navigation, /Capacitor\.isPluginAvailable\("Browser"\)/);
  assert.match(navigation, /browserFinished/);
  assert.match(navigation, /appStateChange/);
  assert.match(navigation, /if \(returned\) return/);
  assert.match(navigation, /trustedReturnPath/);
  assert.match(navigation, /try\s*\{/);
  assert.match(navigation, /catch \(error\)/);
  assert.match(navigation, /window\.location\.assign/);
});

test("Customer and Driver checkout dismissal refreshes trusted payment status without creating another checkout", () => {
  const customer = readFileSync("src/app/book/page.tsx", "utf8");
  const driver = readFileSync("src/app/driver/commission-payments/page.tsx", "utf8");
  const result = readFileSync("src/components/payments/PaymentResultClient.tsx", "utf8");

  assert.match(customer, /openHostedPaymentCheckout\(checkoutJson\.redirectUrl,[\s\S]*returnPath: `\/payment\/success\?tripId=/);
  assert.match(driver, /openHostedPaymentCheckout\(body\.redirectUrl,[\s\S]*returnPath: `\/driver\/payment\/success\?attemptId=/);
  assert.match(result, /closeHostedPaymentCheckout/);
  assert.doesNotMatch(result, /await import\("@capacitor\/browser"\)/);
});
