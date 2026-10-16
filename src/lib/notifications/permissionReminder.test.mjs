import assert from "node:assert/strict";
import test from "node:test";
import { classifyNotificationPermission, shouldShowNotificationReminder } from "./permissionReminder.ts";

test("permission states distinguish granted, blocked, limited and unsupported", () => {
  assert.equal(classifyNotificationPermission("granted", true), "granted");
  assert.equal(classifyNotificationPermission("denied", true), "denied");
  assert.equal(classifyNotificationPermission("provisional", true), "limited");
  assert.equal(classifyNotificationPermission("limited", true), "limited");
  assert.equal(classifyNotificationPermission("prompt", true), "prompt");
  assert.equal(classifyNotificationPermission(null, false), "unsupported");
});

test("reminder yields to active work and stays dismissed until a new foreground session", () => {
  assert.equal(shouldShowNotificationReminder("prompt", true, false), true);
  assert.equal(shouldShowNotificationReminder("denied", true, false), true);
  assert.equal(shouldShowNotificationReminder("limited", true, false), true);
  assert.equal(shouldShowNotificationReminder("prompt", true, true), false);
  assert.equal(shouldShowNotificationReminder("prompt", false, false), false);
  assert.equal(shouldShowNotificationReminder("granted", true, false), false);
  assert.equal(shouldShowNotificationReminder("unsupported", true, false), false);
});
