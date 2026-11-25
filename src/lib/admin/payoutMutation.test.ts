import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const payoutMutation: Promise<typeof import("./payoutMutation")> =
  import(new URL("./payoutMutation.ts", import.meta.url).href);

async function handlePayoutMutation(...args: Parameters<typeof import("./payoutMutation").handlePayoutMutation>) {
  return (await payoutMutation).handlePayoutMutation(...args);
}

const actor = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const operation = "10000000-0000-4000-8000-000000000003";
const allocate = { action: "allocate", trip: other, operation };
const request = (body: object, method = "POST") => new Request("https://local.invalid", {
  method, body: method === "GET" ? undefined : JSON.stringify(body),
});

test("POST rejects unauthenticated and operational sessions before calling RPC", async () => {
  const unauthenticated = await handlePayoutMutation(request(allocate), async () => ({ ok: false, status: 401 }));
  assert.equal(unauthenticated.status, 401);
  const operational = await handlePayoutMutation(request({ ...allocate, role: "owner" }), async () => ({
    ok: true, actor, financial: false, rpc: async () => assert.fail("RPC called"),
  }));
  assert.equal(operational.status, 403);
});

test("GET, forged actor identity and caller-supplied roles cannot invoke a mutation", async () => {
  const authenticate = async () => ({
    ok: true as const, actor, financial: true, rpc: async () => assert.fail("RPC called"),
  });
  assert.equal((await handlePayoutMutation(request(allocate, "GET"), authenticate)).status, 405);
  for (const injected of [{ p_actor: other }, { actor: other }, { role: "owner" }]) {
    assert.equal((await handlePayoutMutation(request({ ...allocate, ...injected }), authenticate)).status, 400);
  }
});

test("all five actions bind the authenticated actor and use a fixed RPC mapping", async () => {
  const fee = { external: "provider reference", percentage: 171, fixed: 200, total: 371 };
  const manual = { operation, cents: 10, paid_on: "2026-11-25", bank_reference: "bank ref" };
  const cases = [
    [allocate, "commission_first_allocate"],
    [{ ...fee, action: "recordProviderFee", payment: other, evidence: "statement ref" }, "commission_first_record_provider_fee"],
    [{ ...fee, action: "reviewProviderFee", evidence: other }, "commission_first_review_provider_fee"],
    [{ ...manual, action: "recordManualPayment", allocation: other, evidence_reference: "evidence ref" }, "commission_first_record_manual_payment"],
    [{ ...manual, action: "verifyManualPayment", payment: other, independent_evidence: "independent ref" }, "commission_first_verify_manual_payment"],
  ] as const;
  for (const [body, rpcName] of cases) {
    const response = await handlePayoutMutation(request(body), async () => ({
      ok: true, actor, financial: true,
      rpc: async (name, args) => {
        assert.equal(name, rpcName);
        assert.equal(args.p_actor, actor);
        return { data: other, error: null };
      },
    }));
    assert.equal(response.status, 200);
  }
});

test("database reviewer rejection and missing capability surface without a fallback", async () => {
  const body = { action: "reviewProviderFee", evidence: other, external: "reference", percentage: 171, fixed: 200, total: 371 };
  for (const [code, status] of [["42501", 409], ["PGRST202", 503]] as const) {
    let calls = 0;
    const response = await handlePayoutMutation(request(body), async () => ({
      ok: true, actor, financial: true, rpc: async () => {
        calls += 1;
        return { data: null, error: { code } };
      },
    }));
    assert.equal(response.status, status);
    assert.equal(calls, 1);
  }
});

test("allocation establishes the original payable inside the policy-gated SQL writer", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261125120000_commission_first_payout_records.sql", import.meta.url), "utf8");
  const writer = sql.slice(sql.indexOf("create function public.commission_first_allocate("));
  const policy = writer.indexOf("Trip outside active payout policy");
  const opening = writer.indexOf("perform public.phase3_post_completed_online_driver_payable(t.id)");
  const allocation = writer.indexOf("insert into public.commission_first_payout_allocations");
  assert.ok(policy >= 0 && opening > policy && allocation > opening);
  assert.match(sql, /left join public\.commission_first_payout_allocations a on a\.payable_id = p\.id/);
  assert.match(sql, /coalesce\(a\.net_cents, p\.payable_cents\) as effective_payable_cents/);
});
