import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("audit actor constraints use the Supabase Auth identity domain", () => {
  const migration = source("../../../docs/phase-05h-005-actor-foreign-key-alignment.sql");

  assert.match(migration, /trip_events[\s\S]*references auth\.users\(id\)[\s\S]*on delete set null/i);
  assert.match(migration, /driver_wallet_transactions[\s\S]*references auth\.users\(id\)[\s\S]*on delete set null/i);
  assert.match(migration, /not exists[\s\S]*auth\.users/i);
  assert.match(migration, /validate constraint trip_events_created_by_fkey/i);
  assert.match(migration, /validate constraint driver_wallet_transactions_created_by_fkey/i);
});

test("customer live location reads the production timestamp column", () => {
  const route = source("../../app/api/customer/trip-location/route.ts");

  assert.match(route, /select\("lat,lng,heading,captured_at"\)/);
  assert.match(route, /last_seen: liveLocation\.captured_at/);
  assert.doesNotMatch(route, /liveLocation\.recorded_at/);
});

test("driver trip actions handle their feedback without a duplicate global banner", () => {
  const driverPage = source("../../app/driver/page.tsx");
  const notificationBar = source("../../components/InAppNotificationBar.tsx");

  assert.match(driverPage, /"X-MOOVU-Feedback-Mode": "local"/);
  assert.match(notificationBar, /x-moovu-feedback-mode/);
  assert.match(notificationBar, /feedbackHandledLocally/);
});

test("unexpected hardened RPC failures include a support reference and remain fail closed", () => {
  const hardenedRpc = source("../server/hardenedRpc.ts");

  assert.match(hardenedRpc, /\[hardened-rpc\] database operation failed/);
  assert.match(hardenedRpc, /contact MOOVU support with code/);
  assert.doesNotMatch(hardenedRpc, /fallback[\s\S]*\.from\(/i);
});
