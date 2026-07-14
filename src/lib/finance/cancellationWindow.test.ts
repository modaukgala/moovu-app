import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { FREE_CANCELLATION_WINDOW_MS, isWithinFreeCancellationWindow } from "./cancellationWindow.ts";

const createdAt = "2026-07-14T10:00:00.000Z";
const createdMs = new Date(createdAt).getTime();

test("the customer correction window lasts three minutes", () => {
  assert.equal(FREE_CANCELLATION_WINDOW_MS, 3 * 60 * 1000);
  assert.equal(isWithinFreeCancellationWindow(createdAt, createdMs + FREE_CANCELLATION_WINDOW_MS), true);
  assert.equal(isWithinFreeCancellationWindow(createdAt, createdMs + FREE_CANCELLATION_WINDOW_MS + 1), false);
});
