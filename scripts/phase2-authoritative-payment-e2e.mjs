import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.PHASE3_E2E_SUPABASE_URL;
const key = process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && key, "Disposable credentials required.");
assert.equal(new URL(url).hostname.split(".")[0], "tangtlmdpnvmoviwrgvd");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const ok = (result, label) => { assert.ifError(result.error, label); return result.data; };

const policy = ok(await db.from("phase2_finance_policy")
  .select("mode,debt_limit_cents,subscription_required,authoritative_effective_from")
  .eq("policy_key", "phase2-driver-finance").single(), "policy");
assert.equal(policy.mode, "AUTHORITATIVE");
assert.equal(Number(policy.debt_limit_cents), 5000);
assert.equal(policy.subscription_required, false);

const trips = ok(await db.from("trips").select("driver_id").like("pickup_address", "Phase 2 durable %")
  .eq("status", "completed").order("created_at", { ascending: false }).limit(3), "fixtures");
const driverId = trips[0]?.driver_id;
assert.ok(driverId);
const admin = ok(await db.from("profiles").select("id").eq("role", "owner").limit(1).single(), "owner");
const before = ok(await db.rpc("phase2_finance_eligibility", { p_driver_id: driverId }), "before position");
assert.equal(before.subscription_required, false);
assert.equal(before.authoritative_eligible, Number(before.net_owed_cents) < 5000);

const amount = Math.max(1, Number(before.net_owed_cents) / 100 + 20);
const request = ok(await db.from("driver_payment_requests").insert({
  driver_id: driverId, payment_type: "commission", amount_expected: Number(before.net_owed_cents) / 100,
  amount_submitted: amount, payment_reference: `P2-AUTH-${crypto.randomUUID()}`,
  note: "Disposable authoritative allocation", status: "pending_payment_review",
}).select("id").single(), "payment request");
const reviewed = ok(await db.rpc("phase2_review_driver_payment", {
  p_request_id: request.id, p_action: "approve", p_review_note: "Disposable validation", p_actor_id: admin.id,
}), "review payment");
assert.equal(reviewed.status, "approved");
assert.equal(Number(reviewed.commission_applied), Number(before.net_owed_cents) / 100);
assert.equal(Number(reviewed.unapplied_excess), 20);
const replay = ok(await db.rpc("phase2_review_driver_payment", {
  p_request_id: request.id, p_action: "approve", p_review_note: "Replay", p_actor_id: admin.id,
}), "replay payment");
assert.equal(replay.replayed, true);
const tx = ok(await db.from("financial_transactions").select("id").eq("idempotency_key", `driver_payment:${request.id}`), "payment tx");
assert.equal(tx.length, 1);
const after = ok(await db.rpc("phase2_finance_eligibility", { p_driver_id: driverId }), "after position");
assert.equal(Number(after.net_owed_cents), 0);
assert.equal(Number(after.unapplied_credit_cents), Number(before.unapplied_credit_cents) + 2000);
assert.equal(after.authoritative_eligible, true);
ok(await db.from("drivers").update({ subscription_status: "inactive", subscription_expires_at: new Date(0).toISOString() })
  .eq("id", driverId), "expire historical subscription");
const unsubscribed = ok(await db.rpc("phase2_finance_eligibility", { p_driver_id: driverId }), "unsubscribed position");
assert.equal(unsubscribed.subscription_required, false);
assert.equal(unsubscribed.authoritative_eligible, true);
console.log("PHASE 2 AUTHORITATIVE PAYMENT AND AUTO-UNLOCK DISPOSABLE E2E PASSED");
