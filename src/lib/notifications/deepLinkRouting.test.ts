import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { buildNotificationRoutingData, resolveNotificationTarget, safeInternalNotificationUrl } from "./deepLinkRouting.ts";

const tripId = "b6ad0914-94bf-4cd1-8e07-d6b286f418ce";

test("customer status notifications open the active trip", () => {
  assert.equal(
    resolveNotificationTarget({ role: "customer", type: "driver_arrived", trip_id: tripId }),
    `/ride/${tripId}`,
  );
});

test("customer completion opens the receipt", () => {
  assert.equal(
    resolveNotificationTarget({ role: "customer", type: "trip_completed", tripId }),
    `/ride/${tripId}/receipt`,
  );
});

test("chat routes to the correct participant screen", () => {
  assert.equal(
    resolveNotificationTarget({ role: "customer", nativeActionType: "chat_reply", tripId }),
    `/ride/${tripId}?chat=1`,
  );
  assert.equal(
    resolveNotificationTarget({ role: "driver", nativeActionType: "chat_reply", tripId }),
    `/driver?chat=1&tripId=${tripId}`,
  );
});

test("driver offers open the offer surface", () => {
  assert.equal(
    resolveNotificationTarget({ role: "driver", nativeActionType: "trip_offer", tripId }),
    `/driver?offerTripId=${tripId}`,
  );
});

test("subscription and document notifications open driver tools", () => {
  assert.equal(
    resolveNotificationTarget({ role: "driver", type: "subscription_reminder" }),
    "/driver/subscriptions",
  );
  assert.equal(
    resolveNotificationTarget({ role: "driver", type: "document_request" }),
    "/driver/complete-profile",
  );
});

test("server routing data includes stable aliases", () => {
  const data = buildNotificationRoutingData({
    role: "customer",
    title: "Trip Completed",
    url: `/ride/${tripId}`,
  });
  assert.equal(data.notificationType, "trip_completed");
  assert.equal(data.screen, "receipt");
  assert.equal(data.tripId, tripId);
  assert.equal(data.trip_id, tripId);
});

test("external notification URLs are rejected", () => {
  assert.equal(safeInternalNotificationUrl("https://attacker.example/phish"), "");
});
