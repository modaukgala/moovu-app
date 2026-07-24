import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { applyCancellationTimingPolicy } from "./cancellationPolicy.ts";

test("customer cancellation is free at one minute", () => {
  const result = applyCancellationTimingPolicy({
    status: "requested",
    insideFreeWindow: true,
    feeAmount: 20,
    driverAmount: 13,
    moovuAmount: 7,
  });
  assert.equal(result.charge, false);
});

test("customer cancellation is free at two minutes fifty-nine seconds", () => {
  const result = applyCancellationTimingPolicy({
    status: "offered",
    insideFreeWindow: true,
    feeAmount: 20,
    driverAmount: 13,
    moovuAmount: 7,
  });
  assert.equal(result.charge, false);
});

test("customer cancellation uses the service fee after three minutes", () => {
  const result = applyCancellationTimingPolicy({
    status: "requested",
    insideFreeWindow: false,
    feeAmount: 20,
    driverAmount: 13,
    moovuAmount: 7,
  });
  assert.equal(result.charge, true);
  assert.equal(result.driverAmount, 0);
  assert.equal(result.moovuAmount, 20);
});

test("assigned-driver cancellation splits the fee after three minutes", () => {
  const result = applyCancellationTimingPolicy({
    status: "assigned",
    insideFreeWindow: false,
    feeAmount: 20,
    driverAmount: 13,
    moovuAmount: 7,
  });
  assert.equal(result.charge, true);
  assert.equal(result.driverAmount, 13);
  assert.equal(result.moovuAmount, 7);
});
