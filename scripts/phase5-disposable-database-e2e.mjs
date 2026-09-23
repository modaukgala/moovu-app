import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.PHASE3_E2E_SUPABASE_URL;
const key = process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && key, "Disposable Supabase credentials are required.");
assert.equal(new URL(url).hostname.split(".")[0], "tangtlmdpnvmoviwrgvd", "Disposable project guard failed.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const marker = crypto.randomUUID();

const { data: customers, error: customerError } = await db.from("customers").select("id,auth_user_id").limit(20);
assert.ifError(customerError); assert.ok(customers?.length >= 2, "Two disposable customers are required.");
let customer;
for (const candidate of customers) {
  const candidateState = await db.rpc("phase5_customer_state", { p_customer_id: candidate.id });
  assert.ifError(candidateState.error);
  if (!candidateState.data.membership_active) { customer = candidate; break; }
}
assert.ok(customer, "A disposable non-member Customer is required.");
const { data: admin, error: adminError } = await db.from("profiles").select("id,role").in("role", ["owner", "admin"]).limit(1).single();
assert.ifError(adminError);

const sourceId = crypto.randomUUID();
const { data: issued, error: issueError } = await db.rpc("phase5_issue_credit", {
  p_customer_id: customer.id, p_amount_cents: 1000, p_source_type: "ADMIN_ADJUSTMENT", p_source_id: sourceId,
  p_policy_version: "phase5-disposable-owner-v1", p_idempotency_key: `e2e:credit:${marker}`,
  p_actor_id: admin.id, p_reason: "Disposable Phase 5 validation",
});
assert.ifError(issueError); assert.equal(issued.replayed, false);
const creditState = await db.rpc("phase5_customer_state", { p_customer_id: customer.id });
assert.ifError(creditState.error);
const availableBeforeBooking = Number(creditState.data.available_credit_cents);
const chargeBeforeCredit = 10000 + (creditState.data.membership_active ? 0 : 300);
const tripPayload = { customer_id: customer.id, status: "requested", payment_method: "cash", ride_option: "go",
  pickup_address: "Disposable pickup", dropoff_address: "Disposable dropoff", distance_km: 5, duration_min: 10,
  start_otp: "1111", end_otp: "2222", start_otp_verified: false, end_otp_verified: false };
const bookingKey = crypto.randomUUID();
const args = { p_customer_id: customer.id, p_actor_id: customer.auth_user_id, p_booking_key: bookingKey,
  p_trip_payload: tripPayload, p_ride_fare_cents: 10000, p_ride_option: "go",
  p_expected_customer_total_cents: Math.max(0, chargeBeforeCredit - availableBeforeBooking) };
const first = await db.rpc("phase5_create_trip", args); assert.ifError(first.error); assert.equal(first.data.replayed, false);
const replay = await db.rpc("phase5_create_trip", args); assert.ifError(replay.error); assert.equal(replay.data.replayed, true);
assert.equal(first.data.trip.id, replay.data.trip.id);
const { data: redemptions, error: redemptionError } = await db.from("phase5_credit_redemptions").select("amount_cents").eq("trip_id", first.data.trip.id);
assert.ifError(redemptionError); assert.equal(redemptions.reduce((sum, row) => sum + Number(row.amount_cents), 0), Math.min(chargeBeforeCredit, availableBeforeBooking));

const concurrentSource = crypto.randomUUID();
const concurrentCredit = await db.rpc("phase5_issue_credit", { p_customer_id: customer.id, p_amount_cents: 500,
  p_source_type: "ADMIN_ADJUSTMENT", p_source_id: concurrentSource, p_policy_version: "phase5-disposable-owner-v1",
  p_idempotency_key: `e2e:concurrent-credit:${marker}`, p_actor_id: admin.id, p_reason: "Disposable concurrency validation" });
assert.ifError(concurrentCredit.error);
const concurrentState = await db.rpc("phase5_customer_state", { p_customer_id: customer.id }); assert.ifError(concurrentState.error);
const concurrentCharge = 10000 + (concurrentState.data.membership_active ? 0 : 300);
const expectedConcurrentTotal = Math.max(0, concurrentCharge - Number(concurrentState.data.available_credit_cents));
const competing = [crypto.randomUUID(), crypto.randomUUID()].map((keyValue) => db.rpc("phase5_create_trip", {
  ...args, p_booking_key: keyValue, p_expected_customer_total_cents: expectedConcurrentTotal,
}));
const results = await Promise.all(competing);
if (results.filter((result) => !result.error).length !== 1) {
  console.error(results.map((result) => result.error ? { code: result.error.code, message: result.error.message } : { ok: true }));
}
assert.equal(results.filter((result) => !result.error).length, 1, "Exactly one competing credit booking must succeed.");
assert.equal(results.filter((result) => result.error?.message?.includes("PHASE5_QUOTE_CHANGED")).length, 1);

const paymentKey = crypto.randomUUID();
const submitted = await db.rpc("phase5_submit_membership_payment", { p_customer_id: customer.id,
  p_reference: `DISPOSABLE-${marker.slice(0, 8)}`, p_proof_path: "", p_submission_key: paymentKey });
assert.ifError(submitted.error); assert.equal(submitted.data.status, "SUBMITTED");
const beforeApproval = await db.rpc("phase5_customer_state", { p_customer_id: customer.id });
assert.ifError(beforeApproval.error); assert.equal(beforeApproval.data.membership_active, false);
const approvals = await Promise.all([1, 2].map(() => db.rpc("phase5_approve_membership_payment", { p_payment_id: submitted.data.payment_id,
  p_actor_id: admin.id, p_reason: "Verified disposable transfer" })));
for (const approval of approvals) assert.ifError(approval.error);
assert.deepEqual(approvals.map((approval) => approval.data.replayed).sort(), [false, true]);
const afterApproval = await db.rpc("phase5_customer_state", { p_customer_id: customer.id });
assert.ifError(afterApproval.error); assert.equal(afterApproval.data.membership_active, true);

const { data: imbalance, error: ledgerError } = await db.rpc("phase1_ledger_imbalance_count");
if (ledgerError?.code !== "PGRST202") assert.ifError(ledgerError);
if (!ledgerError) assert.equal(Number(imbalance), 0);
console.log("PHASE 5 DISPOSABLE DATABASE E2E PASSED");
