import assert from "node:assert/strict";
import test from "node:test";
const { callHardenedRpc, PHASE_05B_CONTRACT_VERSION } = await import(
  new URL("./hardenedRpc.ts", import.meta.url).href
);

const client = (response: unknown) => ({ rpc: async () => response }) as never;

test("missing RPC fails closed", async () => {
  const result = await callHardenedRpc(client({ data: null, error: { code: "PGRST202", message: "missing", details: "", hint: "" } }), "x", {});
  assert.deepEqual(result, {
    ok: false, status: 503, code: "contract_unavailable",
    error: "Required hardened database contract is unavailable. No changes were made.",
  });
});

test("unsupported contract fails closed", async () => {
  const result = await callHardenedRpc(client({ data: { contract_version: "old" }, error: null }), "x", {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "contract_incompatible");
});

test("versioned result is accepted", async () => {
  const result = await callHardenedRpc(client({ data: { contract_version: PHASE_05B_CONTRACT_VERSION, replayed: false }, error: null }), "x", {});
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.result.replayed, false);
});

test("business rejection never requests a fallback", async () => {
  const result = await callHardenedRpc(client({ data: null, error: { code: "P0001", message: "invalid state", details: "", hint: "" } }), "x", {});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.equal(result.code, "operation_rejected");
  }
});

test("permission denial fails closed as an operation failure", async () => {
  const previousConsoleError = console.error;
  console.error = () => undefined;
  const result = await callHardenedRpc(client({ data: null, error: { code: "42501", message: "permission denied", details: "", hint: "" } }), "x", {});
  console.error = previousConsoleError;
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 500);
    assert.equal(result.code, "operation_failed");
    assert.match(result.error, /contact MOOVU support with code [A-F0-9]{8}/);
    assert.match(result.referenceId ?? "", /^[A-F0-9]{8}$/);
  }
});

test("unexpected database failure never invokes a second mutation", async () => {
  let calls = 0;
  const previousConsoleError = console.error;
  console.error = () => undefined;
  const result = await callHardenedRpc({ rpc: async () => {
    calls += 1;
    return { data: null, error: { code: "XX000", message: "transaction aborted", details: "", hint: "" } };
  } } as never, "x", {});
  console.error = previousConsoleError;
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
});
