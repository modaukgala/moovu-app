import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { isSuggestionTap } from "./suggestionGesture.ts";

test("a suggestion tap selects on release", () => {
  assert.equal(isSuggestionTap(120, 122), true);
});

test("scrolling suggestions does not select an item", () => {
  assert.equal(isSuggestionTap(120, 148), false);
  assert.equal(isSuggestionTap(null, 120), false);
});
