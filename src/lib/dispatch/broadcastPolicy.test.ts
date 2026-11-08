import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types uses explicit extensions.
import { broadcastCandidates, boundedMap } from "./broadcastPolicy.ts";

for (const count of [1, 2, 5, 12, 25, 50, 100, 251]) {
  test(`${count} eligible candidates are not truncated by the batch size`, async () => {
    const rows = Array.from({ length: count }, (_, id) => ({ driverId: String(id) }));
    const selected = broadcastCandidates([...rows, rows[0]]);
    assert.deepEqual(selected, rows);
    let active = 0;
    let peak = 0;
    const persisted = await boundedMap(selected, 5, async row => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return row.driverId;
    });
    assert.deepEqual(persisted, rows.map(row => row.driverId));
    assert.ok(peak <= 5);
    // This is a pure fan-out test, not PostgreSQL offer-persistence certification.
  });
}
test("explicit Admin targeting is preserved", () => {
  assert.deepEqual(broadcastCandidates([{ driverId: "A" }, { driverId: "B" }], "B"), [{ driverId: "B" }]);
});
test("failed authoritative lookups fail the operation rather than returning a partial success", async () => {
  await assert.rejects(boundedMap([1, 2, 3], 2, async value => {
    if (value === 2) throw new Error("Lookup unavailable");
    return value;
  }), /Lookup unavailable/);
});
