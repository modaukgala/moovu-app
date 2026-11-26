import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner requires an explicit TypeScript extension.
import { paymentQueueCounts } from "./operationalCounts.ts";

test("keeps pending proofs and awaiting confirmation distinct", () => {
  assert.deepEqual(paymentQueueCounts([
    { status: "pending_payment_review", payment_type: "subscription" },
    { status: "waiting_confirmation", payment_type: "commission" },
  ]), { pendingProofs: 1, awaitingConfirmation: 1, subscriptionProofs: 1, commissionProofs: 0 });
});

