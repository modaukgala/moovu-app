import assert from "node:assert/strict";
import test from "node:test";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { calculateCommissionCents, phase2FinanceState, phase2Mode, phase2RequiresSubscription } from "./phase2Policy.ts";

test("mode fails safely to OFF", () => {
  assert.equal(phase2Mode(undefined), "OFF");
  assert.equal(phase2Mode("unexpected"), "OFF");
  assert.equal(phase2Mode("shadow"), "SHADOW");
});

test("commission is calculated in integer cents with half-up rounding", () => {
  assert.equal(calculateCommissionCents(BigInt(10_000)), BigInt(1_500));
  assert.equal(calculateCommissionCents(BigInt(101)), BigInt(15));
  assert.equal(calculateCommissionCents(BigInt(103)), BigInt(15));
  assert.equal(calculateCommissionCents(BigInt(104)), BigInt(16));
});

test("R50 is the exact hard boundary", () => {
  assert.equal(phase2FinanceState(BigInt(0)).eligible, true);
  assert.equal(phase2FinanceState(BigInt(4_999)).eligible, true);
  assert.equal(phase2FinanceState(BigInt(5_000)).eligible, false);
  assert.equal(phase2FinanceState(BigInt(5_001)).eligible, false);
  assert.equal(phase2FinanceState(BigInt(10_000)).eligible, false);
});

test("subscription is removed only after authority cutover", () => {
  assert.equal(phase2RequiresSubscription("OFF"), true);
  assert.equal(phase2RequiresSubscription("SHADOW"), true);
  assert.equal(phase2RequiresSubscription("AUTHORITATIVE"), false);
});
