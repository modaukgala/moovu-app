import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node strip-types tests require the explicit extension.
import { adminPaymentReviewCounts } from "./paymentReviewCounts.ts";

test("Dashboard and sidebar use the same payment review population", () => {
  const counts = adminPaymentReviewCounts([
    { payment_type: "subscription", status: "pending_payment_review" },
    { payment_type: "commission", status: "waiting_confirmation" },
    { payment_type: "commission", status: "approved" },
    { payment_type: "subscription", status: "rejected" },
  ]);
  assert.deepEqual(counts, { all: 2, subscription: 1, commission: 1, waiting: 1 });
});
