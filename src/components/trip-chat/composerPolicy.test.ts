import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node's strip-types test runner requires explicit TypeScript extensions.
import { canSendChatDraft, shouldSendChatFromKeyboard } from "./composerPolicy.ts";

test("Enter variants insert line breaks instead of sending", () => {
  const variants = [
    { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false },
    { key: "Enter", shiftKey: true, ctrlKey: false, metaKey: false },
    { key: "Enter", shiftKey: false, ctrlKey: true, metaKey: false },
    { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: true },
  ];

  for (const variant of variants) {
    assert.equal(shouldSendChatFromKeyboard(variant), false);
  }
});

test("only a non-empty enabled draft can be sent from the visible button", () => {
  assert.equal(canSendChatDraft("Hello\nthere", true, false), true);
  assert.equal(canSendChatDraft("  \n  ", true, false), false);
  assert.equal(canSendChatDraft("Hello", false, false), false);
  assert.equal(canSendChatDraft("Hello", true, true), false);
});
