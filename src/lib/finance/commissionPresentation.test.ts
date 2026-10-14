import test from "node:test";
import assert from "node:assert/strict";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { commissionDueAmount } from "./commissionPresentation.ts";

test("uses authoritative cents over the legacy wallet snapshot", () => {
  assert.equal(commissionDueAmount({ mode: "AUTHORITATIVE", netOwedCents: 12550 }, 90), 125.5);
  assert.equal(commissionDueAmount({ mode: "AUTHORITATIVE", netOwedCents: 0 }, 90), 0);
});

test("uses the wallet only when no valid authority is returned", () => {
  assert.equal(commissionDueAmount(null, 90), 90);
  assert.equal(commissionDueAmount(undefined, null), 0);
  assert.equal(commissionDueAmount({ mode: "AUTHORITATIVE", netOwedCents: Number.NaN }, 90), 90);
});
