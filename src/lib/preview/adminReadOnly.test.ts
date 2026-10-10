import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types tests require the explicit extension.
import { adminPreviewDecision } from "./adminReadOnly.ts";

const safeEnv = {
  VERCEL_ENV: "preview",
  MOOVU_ADMIN_PREVIEW_READ_ONLY: "true",
  NEXT_PUBLIC_SUPABASE_URL: "https://tangtlmdpnvmoviwrgvd.supabase.co",
};

test("production routing remains unchanged", () => {
  assert.equal(adminPreviewDecision({ env: { VERCEL_ENV: "production" }, pathname: "/api/payments/yoco/checkout", method: "POST" }), "allow");
});

test("preview fails closed without explicit disposable read-only configuration", () => {
  for (const env of [
    { ...safeEnv, MOOVU_ADMIN_PREVIEW_READ_ONLY: undefined },
    { ...safeEnv, NEXT_PUBLIC_SUPABASE_URL: "https://mvazbszenqahgqpznhhq.supabase.co" },
    { ...safeEnv, NEXT_PUBLIC_SUPABASE_URL: "http://tangtlmdpnvmoviwrgvd.supabase.co" },
    { ...safeEnv, YOCO_SECRET_KEY: "configured-secret" },
    { ...safeEnv, FIREBASE_PRIVATE_KEY: "configured-secret" },
    { ...safeEnv, PHASE05_OUTBOX_ENABLED: "true" },
    { ...safeEnv, PUSH_INTERNAL_API_KEY: "configured-secret" },
  ]) {
    assert.equal(adminPreviewDecision({ env, pathname: "/admin", method: "GET" }), "configuration_blocked");
  }
});

test("preview permits only Admin pages and reviewed read endpoints", () => {
  for (const path of ["/admin", "/admin/login", "/admin/drivers", "/api/admin/analytics", "/api/admin/application-summary", "/api/admin/trips/list", "/_next/static/chunk.js"]) {
    assert.equal(adminPreviewDecision({ env: safeEnv, pathname: path, method: "GET" }), "allow", path);
  }
  for (const path of ["/api/payments/yoco/checkout", "/api/payments/yoco/webhook", "/api/jobs/online-payment-dispatch", "/api/jobs/outbox", "/api/notifications/send", "/api/push/send", "/api/admin/onboarding/retention", "/driver", "/book"]) {
    assert.equal(adminPreviewDecision({ env: safeEnv, pathname: path, method: "GET" }), "route_blocked", path);
  }
  assert.equal(adminPreviewDecision({ env: safeEnv, pathname: "/api/admin/onboarding", method: "POST" }), "route_blocked");
  assert.equal(adminPreviewDecision({ env: safeEnv, pathname: "/api/admin/trips/assign", method: "POST" }), "route_blocked");
});
