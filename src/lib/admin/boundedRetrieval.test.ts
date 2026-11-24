import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner requires an explicit TypeScript extension.
import { boundedCount, chunkValues, collectBoundedPages } from "./boundedRetrieval.ts";

test("collects matches beyond the first page", async () => {
  const source = Array.from({ length: 230 }, (_, index) => index);
  const result = await collectBoundedPages({ pageSize: 100, maxRows: 500, load: async (from, to) => source.slice(from, to + 1) });
  assert.equal(result.rows.at(-1), 229);
  assert.equal(result.complete, true);
});

test("marks a reached boundary as incomplete instead of returning a complete total", async () => {
  const source = Array.from({ length: 151 }, (_, index) => index);
  const result = await collectBoundedPages({ pageSize: 50, maxRows: 150, load: async (from, to) => source.slice(from, to + 1) });
  assert.equal(result.complete, false);
  assert.deepEqual(boundedCount(result.rows.length, result.complete), { total: null, totalIsLowerBound: true });
});

test("historical driver search keeps more than one hundred candidates", () => {
  const candidates = Array.from({ length: 230 }, (_, index) => `driver-${index}`);
  const chunks = chunkValues(candidates, 100);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [100, 100, 30]);
  assert.equal(chunks.flat().length, 230);
});
