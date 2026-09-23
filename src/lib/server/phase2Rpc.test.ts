import assert from "node:assert/strict";
import test from "node:test";
const { callPhase2Rpc } = await import(new URL("./phase2Rpc.ts", import.meta.url).href);

const client = (response: unknown) => ({ rpc: async () => response }) as never;

test("missing Phase 2 RPC fails closed with one call", async () => {
  let calls = 0;
  const result = await callPhase2Rpc({ rpc: async () => {
    calls += 1;
    return { data: null, error: { code: "PGRST202", message: "missing", details: "", hint: "" } };
  } } as never, "phase2_missing", {});
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: false, status: 503, code: "contract_unavailable", error: "Phase 2 database contract is unavailable. No changes were made." });
});

test("unsupported contract never becomes success", async () => {
  const result = await callPhase2Rpc(client({ data: { contract_version: "old" }, error: null }), "phase2_old", {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "contract_incompatible");
});

test("authorization failures are deterministic operation rejections", async () => {
  const result = await callPhase2Rpc(client({
    data: null,
    error: { code: "42501", message: "permission denied", details: "", hint: "", name: "PostgrestError" },
  }), "phase2_post_trip_commission", {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "operation_rejected");
});

test("versioned contract is accepted", async () => {
  const result = await callPhase2Rpc(client({ data: { contract_version: "phase-2-v1", replayed: false }, error: null }), "phase2_ok", {});
  assert.equal(result.ok, true);
});
