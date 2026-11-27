import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node strip-types tests require an explicit extension.
import { staleReminderDue } from "./staleDriverPolicy.ts";

const now = Date.parse("2026-11-27T20:00:00Z");
const ago = (m: number) => new Date(now - m * 60_000).toISOString();
test("reminds once at 30 min and once at 2 h", () => {
  assert.equal(staleReminderDue(ago(10), now), null);
  assert.equal(staleReminderDue(ago(31), now), 30);
  assert.equal(staleReminderDue(ago(50), now), null);
  assert.equal(staleReminderDue(ago(125), now), 120);
  assert.equal(staleReminderDue(ago(300), now), null);
  assert.equal(staleReminderDue(null, now), null);
});
