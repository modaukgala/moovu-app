import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types tests use the TypeScript source directly.
import { bankVerificationAvailable, manualPayoutsAvailable, onlinePayablePostingAvailable, payoutActionAllowed, payoutEffectiveAt, payoutVisibilityAvailable } from "./onlinePayoutAvailability.ts";

test("payout activation requires an unambiguous real UTC timestamp", () => {
  assert.equal(payoutEffectiveAt({}), null);
  assert.equal(payoutEffectiveAt({ MOOVU_PAYOUT_EFFECTIVE_AT: "2026-11-01" }), null);
  assert.equal(payoutEffectiveAt({ MOOVU_PAYOUT_EFFECTIVE_AT: "2026-02-30T00:00:00Z" }), null);
  assert.equal(payoutEffectiveAt({ MOOVU_PAYOUT_EFFECTIVE_AT: "2026-11-01T00:00:00Z" }), "2026-11-01T00:00:00.000Z");
});

const keys = ["MOOVU_PAYOUT_VISIBILITY_ENABLED", "MOOVU_MANUAL_PAYOUTS_ENABLED",
  "MOOVU_ONLINE_PAYABLE_POSTING_ENABLED", "MOOVU_PAYOUT_BANK_VERIFICATION_ENABLED"] as const;

test("payout visibility, recording, posting and bank verification require independent server flags", () => {
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(payoutVisibilityAvailable(), false);
    assert.equal(manualPayoutsAvailable(), false);
    assert.equal(onlinePayablePostingAvailable(), false);
    assert.equal(bankVerificationAvailable(), false);
    assert.equal(payoutActionAllowed("RECORD_MANUAL_PAYMENT"), false);

    process.env.MOOVU_PAYOUT_VISIBILITY_ENABLED = "true";
    assert.equal(payoutVisibilityAvailable(), true);
    assert.equal(payoutActionAllowed("CREATE_DRAFT"), false);
    assert.equal(payoutActionAllowed("RECORD_MANUAL_PAYMENT"), false);
    assert.equal(onlinePayablePostingAvailable(), false);

    process.env.MOOVU_MANUAL_PAYOUTS_ENABLED = "true";
    assert.equal(payoutActionAllowed("RECORD_MANUAL_PAYMENT"), true);
    assert.equal(payoutActionAllowed("VERIFY_MANUAL_PAYMENT"), false);
    assert.equal(payoutActionAllowed("SETTLE_DEBT_ONLY"), false);
    assert.equal(onlinePayablePostingAvailable(), false);

    process.env.MOOVU_PAYOUT_BANK_VERIFICATION_ENABLED = "true";
    assert.equal(payoutActionAllowed("VERIFY_MANUAL_PAYMENT"), true);
    assert.equal(payoutActionAllowed("SETTLE_DEBT_ONLY"), true);
    assert.equal(onlinePayablePostingAvailable(), false);

    process.env.MOOVU_ONLINE_PAYABLE_POSTING_ENABLED = "true";
    assert.equal(onlinePayablePostingAvailable(), true);
    delete process.env.MOOVU_PAYOUT_VISIBILITY_ENABLED;
    assert.equal(payoutActionAllowed("RECORD_MANUAL_PAYMENT"), false);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
