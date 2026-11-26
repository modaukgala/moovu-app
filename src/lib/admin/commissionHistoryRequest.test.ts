import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types requires the extension.
import { createCommissionHistoryRequest } from "./commissionHistoryRequest.ts";

test("independent page failure preserves balance and retries the exact request", async () => {
  const first = { driver: "a", kind: "trips", pages: [2, 1, 1], filter: "2026-09-01" };
  const next = { ...first, pages: [2, 1, 2] };
  const request = createCommissionHistoryRequest<typeof first, { pages: number[]; balance: number }>();
  let view = { pages: first.pages, balance: 620 };
  let error: string | undefined;
  const publish = (state: { error?: string; result?: typeof view }) => {
    error = state.error;
    if (state.result) view = state.result;
  };
  await request.run(next, async () => { throw new Error("Offline"); }, publish);
  assert.deepEqual(view, { pages: [2, 1, 1], balance: 620 });
  assert.equal(error, "Offline");
  await request.run(request.failedRequest()!, async (input) => {
    assert.deepEqual(input, next);
    return { pages: input.pages, balance: 620 };
  }, publish);
  assert.deepEqual(view, { pages: [2, 1, 2], balance: 620 });
  assert.equal(error, undefined);
  assert.equal(request.failedRequest(), undefined);
});

test("timeout settles and driver changes invalidate pending results and retries", async () => {
  const request = createCommissionHistoryRequest<string, string>(5);
  const states: { loading: boolean; error?: string; result?: string }[] = [];
  const publish = (state: typeof states[number]) => states.push(state);
  await request.run("old driver", () => new Promise(() => {}), publish);
  assert.equal(states.at(-1)?.loading, false);
  assert.match(states.at(-1)?.error ?? "", /timed out/);
  request.invalidate();
  assert.equal(request.failedRequest(), undefined);
  let finish: (value: string) => void = () => {};
  const pending = request.run("old driver", () => new Promise((resolve) => { finish = resolve; }), publish);
  await request.run("new driver", async () => "new result", publish);
  finish("stale result");
  await pending;
  assert.deepEqual(states.flatMap((state) => state.result ?? []), ["new result"]);
});
