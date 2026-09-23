import assert from "node:assert/strict";
import test from "node:test";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { formatZarCents, positiveZarCents, zarDecimalToCents } from "./money.ts";

test("decimal money converts to integer cents with explicit half-up rounding", () => {
  assert.equal(zarDecimalToCents("69.00"), BigInt(6900));
  assert.equal(zarDecimalToCents("10.004"), BigInt(1000));
  assert.equal(zarDecimalToCents("10.005"), BigInt(1001));
  assert.equal(zarDecimalToCents("-0.005"), BigInt(-1));
});

test("invalid or non-positive ledger amounts fail", () => {
  assert.throws(() => zarDecimalToCents("NaN"));
  assert.throws(() => positiveZarCents(BigInt(0)));
  assert.throws(() => positiveZarCents(BigInt(-1)));
});

test("rand formatting occurs from cents without floating point", () => {
  assert.equal(formatZarCents(BigInt(128475)), "R1284.75");
  assert.equal(formatZarCents(BigInt(-10)), "-R0.10");
});
