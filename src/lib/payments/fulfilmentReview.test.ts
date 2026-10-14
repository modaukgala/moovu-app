import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types tests require the explicit extension.
import { classifyVerifiedPayment } from "./fulfilmentReview.ts";
import type { OnlinePaymentReportRow } from "./onlineReport";

const payment = { payer_type: "customer", trip_id: "trip-1" } as OnlinePaymentReportRow;
test("verified payment and trip fulfilment are distinct", () => {
  assert.equal(classifyVerifiedPayment(payment, null), "no-trip");
  assert.equal(classifyVerifiedPayment(payment, { id: "trip-1", status: "offered", driver_id: "driver-1", offer_status: "shown" }), "awaiting-driver");
  assert.equal(classifyVerifiedPayment(payment, { id: "trip-1", status: "assigned", driver_id: "driver-1", offer_status: "accepted" }), "allocated");
  assert.equal(classifyVerifiedPayment(payment, { id: "trip-1", status: "ongoing", driver_id: "driver-1", offer_status: "accepted" }), "in-progress");
  assert.equal(classifyVerifiedPayment(payment, { id: "trip-1", status: "completed", driver_id: "driver-1", offer_status: "accepted" }), "completed");
  assert.equal(classifyVerifiedPayment(payment, { id: "trip-1", status: "cancelled", driver_id: null, offer_status: null }), "cancelled");
});
