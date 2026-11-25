import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { applicationNudge } from "./applicationNudge.ts";

test("old-system driver is asked to start the new application but not blocked", () => {
  const n = applicationNudge(null);
  assert.ok(n && /older sign-up/.test(n.body) && /keep going online/.test(n.body));
});

test("draft lists exactly what is missing in plain words", () => {
  const n = applicationNudge({ status: "DRAFT", draft: { personal: { first_name: "A" } } });
  assert.ok(n);
  assert.ok(n.missing.includes("ID document (photo)"));
  assert.ok(n.missing.includes("Driver's licence (photo)"));
  assert.ok(!n.missing.includes("First name"));
});

test("approved application shows nothing; review shows info", () => {
  assert.equal(applicationNudge({ status: "APPROVED" }), null);
  assert.equal(applicationNudge({ status: "UNDER_REVIEW" })?.tone, "info");
});

test("corrections list the targeted items", () => {
  const n = applicationNudge({ status: "CORRECTION_REQUESTED" }, ["drivers_license"]);
  assert.deepEqual(n?.missing, ["Driver's licence (photo)"]);
});
