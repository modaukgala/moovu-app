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

test("commission debt remains payable without an operational ceiling", () => {
  for (const amount of [0, 4999, 5000, 8580, 10000, 15000, 50000]) {
    const state = phase2FinanceState(BigInt(amount));
    assert.equal(state.debtCents, BigInt(amount));
    assert.equal(state.eligible, true);
    assert.equal(state.restricted, false);
    assert.equal(state.warning, false);
    assert.equal(state.remainingCents, null);
  }
});

test("subscription is removed only after authority cutover", () => {
  assert.equal(phase2RequiresSubscription("OFF"), true);
  assert.equal(phase2RequiresSubscription("SHADOW"), true);
  assert.equal(phase2RequiresSubscription("AUTHORITATIVE"), false);
});
