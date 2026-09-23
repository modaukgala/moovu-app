import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.PHASE3_E2E_SUPABASE_URL;
const key = process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && key, "Disposable Supabase credentials are required.");
assert.equal(new URL(url).hostname.split(".")[0], "tangtlmdpnvmoviwrgvd", "Disposable project guard failed.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function ok(result, label) {
  assert.ifError(result.error, label);
  return result.data;
}

const policy = ok(await db.from("phase2_finance_policy").select("mode,go_basis_points,go_xl_basis_points").eq("policy_key", "phase2-driver-finance").single(), "Phase 2 policy");
assert.deepEqual(policy, { mode: "AUTHORITATIVE", go_basis_points: 1500, go_xl_basis_points: 1500 });
const authUsers = ok(await db.auth.admin.listUsers({ page: 1, perPage: 1000 }), "Auth users").users;
const authIds = new Set(authUsers.map((user) => user.id));
const customers = ok(await db.from("customers").select("id,auth_user_id").limit(20), "Customers");
let customer;
for (const candidate of customers) {
  if (!authIds.has(candidate.auth_user_id)) continue;
  const state = ok(await db.rpc("phase5_customer_state", { p_customer_id: candidate.id }), "Customer state");
  if (!state.membership_active && Number(state.available_credit_cents) === 0) { customer = candidate; break; }
}
assert.ok(customer, "A disposable non-member Customer without credit is required.");
const driverAccounts = ok(await db.from("driver_accounts").select("user_id,driver_id").not("driver_id", "is", null).limit(100), "Driver accounts");
const driver = driverAccounts.find((entry) => authIds.has(entry.user_id));
assert.ok(driver, "An authenticated disposable Driver mapping is required.");
const adminProfiles = ok(await db.from("profiles").select("id,role").in("role", ["owner", "admin"]).limit(100), "Financial Admins");
const admin = adminProfiles.find((entry) => authIds.has(entry.id));
assert.ok(admin, "An authenticated disposable Financial Admin is required.");

async function prepare(mode) {
  const booked = ok(await db.rpc("phase5_create_trip", {
    p_customer_id: customer.id, p_actor_id: customer.auth_user_id, p_booking_key: crypto.randomUUID(),
    p_trip_payload: { customer_id: customer.id, status: "requested", payment_method: "cash", ride_option: "go",
      pickup_address: `Phase 2 durable ${mode}`, dropoff_address: `Phase 2 durable ${mode}`,
      distance_km: 5, duration_min: 1, start_otp: "1111", end_otp: "2222" },
    p_ride_fare_cents: 10000, p_ride_option: "go", p_expected_customer_total_cents: 10300,
  }), `Book ${mode}`);
  const tripId = booked.trip.id;
  const trip = ok(await db.from("trips").update({ driver_id: driver.driver_id, status: "ongoing", start_otp_verified: true,
    trip_started_at: new Date(Date.now() - 5 * 60_000).toISOString() }).eq("id", tripId)
    .select("financial_version,phase5_driver_fare_basis_cents,phase5_service_fee_cents").single(), `Prepare ${mode}`);
  assert.equal(Number(trip.phase5_driver_fare_basis_cents), 10000);
  assert.equal(Number(trip.phase5_service_fee_cents), 300);
  const actor = mode === "admin" ? admin.id : driver.user_id;
  const args = { p_trip_id: tripId, p_actor_id: actor, p_expected_driver_id: driver.driver_id, p_mode: mode,
    p_otp: mode === "otp" ? "2222" : null,
    p_reason: mode === "bypass" ? "Connectivity issue" : null,
    p_note: mode === "admin" ? "Disposable Admin completion" : null,
    p_expected_financial_version: Number(trip.financial_version), p_expected_fare: 100,
    p_distance_audit: "Disposable durable recovery validation" };
  const completed = ok(await db.rpc("phase05b_complete_trip", args), `Complete ${mode}`);
  assert.equal(completed.replayed, false);
  const queue = ok(await db.from("phase2_shadow_recovery_jobs").select("id,status,attempts").eq("operation_key", `trip_commission:${tripId}`).single(), `Queue ${mode}`);
  assert.equal(queue.status, "pending");
  return { tripId, args, queue };
}

const fixtures = [];
for (const mode of ["otp", "bypass", "admin"]) fixtures.push(await prepare(mode));

// Reproduce the production boundary: authoritative completion has committed, then
// the immediate observational attempt is recorded as a retryable infrastructure failure.
for (const fixture of fixtures) {
  const claim = ok(await db.rpc("phase2_claim_shadow_recovery_job", { p_operation_key: `trip_commission:${fixture.tripId}` }), "Initial claim");
  assert.equal(claim.claimed, true);
  const failed = ok(await db.rpc("phase2_finish_shadow_recovery_job", { p_job_id: claim.job.id, p_succeeded: false,
    p_retryable: true, p_error_code: "operation_failed", p_error_message: "Simulated Bad Gateway" }), "Record transient failure");
  assert.equal(failed.status, "retryable_failure");
}
await new Promise((resolve) => setTimeout(resolve, 31_000));

// Two real HTTP requests produce separate database sessions; only one can claim the same job.
const target = fixtures[1];
const overlapping = await Promise.all([1, 2].map(() => db.rpc("phase2_claim_shadow_recovery_job", { p_operation_key: `trip_commission:${target.tripId}` })));
overlapping.forEach((result) => assert.ifError(result.error));
assert.equal(overlapping.filter((result) => result.data.claimed).length, 1);
const targetClaim = overlapping.find((result) => result.data.claimed).data.job;
const simultaneousPosts = await Promise.all([1, 2].map(() => db.rpc("phase2_post_trip_commission", { p_trip_id: target.tripId, p_actor_id: driver.user_id })));
simultaneousPosts.forEach((result) => assert.ifError(result.error));
assert.deepEqual(simultaneousPosts.map((result) => result.data.replayed).sort(), [false, true]);
ok(await db.rpc("phase2_finish_shadow_recovery_job", { p_job_id: targetClaim.id, p_succeeded: true, p_retryable: false,
  p_error_code: null, p_error_message: null }), "Finish overlapping recovery");

for (const fixture of fixtures.filter((item) => item !== target)) {
  const claim = ok(await db.rpc("phase2_claim_shadow_recovery_job", { p_operation_key: `trip_commission:${fixture.tripId}` }), "Recovery claim");
  assert.equal(claim.claimed, true);
  ok(await db.rpc("phase2_post_trip_commission", { p_trip_id: fixture.tripId, p_actor_id: modeActor(fixture) }), "Recovery posting");
  ok(await db.rpc("phase2_finish_shadow_recovery_job", { p_job_id: claim.job.id, p_succeeded: true, p_retryable: false,
    p_error_code: null, p_error_message: null }), "Finish recovery");
}

function modeActor(fixture) { return fixture.args.p_actor_id; }

for (const fixture of fixtures) {
  const keyValue = `trip_commission:${fixture.tripId}`;
  const transactions = ok(await db.from("financial_transactions").select("id,currency,transaction_state").eq("idempotency_key", keyValue), "Transactions");
  assert.equal(transactions.length, 1);
  assert.deepEqual({ currency: transactions[0].currency, state: transactions[0].transaction_state },
    { currency: "ZAR", state: "POSTED" });
  const entries = ok(await db.from("financial_ledger_entries").select("entry_side,amount_cents").eq("transaction_id", transactions[0].id), "Ledger entries");
  assert.equal(entries.length, 2);
  assert.equal(entries.filter((row) => row.entry_side === "DEBIT").reduce((sum, row) => sum + Number(row.amount_cents), 0), 1500);
  assert.equal(entries.filter((row) => row.entry_side === "CREDIT").reduce((sum, row) => sum + Number(row.amount_cents), 0), 1500);
  const reconciliations = ok(await db.from("phase2_shadow_reconciliations").select("id,ledger_amount_cents").eq("operation_key", keyValue), "Reconciliation");
  assert.equal(reconciliations.length, 1);
  assert.equal(Number(reconciliations[0].ledger_amount_cents), 1500);
  const queue = ok(await db.from("phase2_shadow_recovery_jobs").select("status,attempts,financial_transaction_id,reconciliation_id").eq("operation_key", keyValue).single(), "Final queue");
  assert.equal(queue.status, "succeeded");
  assert.equal(queue.attempts, 2);
  assert.ok(queue.financial_transaction_id && queue.reconciliation_id);
  const replay = ok(await db.rpc("phase05b_complete_trip", fixture.args), "Completion replay");
  assert.equal(replay.replayed, true);
  const noClaim = ok(await db.rpc("phase2_claim_shadow_recovery_job", { p_operation_key: keyValue }), "Succeeded replay claim");
  assert.equal(noClaim.claimed, false);
  assert.equal(ok(await db.from("financial_transactions").select("id").eq("idempotency_key", keyValue), "Replay transaction count").length, 1);
  assert.equal(ok(await db.from("moovu_business_events").select("id").eq("event_key", `trip-complete:${fixture.tripId}`), "Business event count").length, 1);
  assert.equal(ok(await db.from("driver_wallet_transactions").select("id").eq("trip_id", fixture.tripId).eq("tx_type", "commission"), "Legacy commission count").length, 0);
}

// Keep this reusable disposable test self-cleaning if an earlier interrupted run
// committed its completion before the recovery assertions finished.
const unfinished = ok(await db.from("phase2_shadow_recovery_jobs").select("id,trip_id,operation_key,status").neq("status", "succeeded"), "Unfinished fixture jobs");
for (const job of unfinished) {
  const trip = ok(await db.from("trips").select("pickup_address").eq("id", job.trip_id).single(), "Unfinished fixture trip");
  if (!String(trip.pickup_address ?? "").startsWith("Phase 2 durable ")) continue;
  const claim = ok(await db.rpc("phase2_claim_shadow_recovery_job", { p_operation_key: job.operation_key }), "Interrupted fixture claim");
  if (!claim.claimed) continue;
  ok(await db.rpc("phase2_post_trip_commission", { p_trip_id: job.trip_id, p_actor_id: driver.user_id }), "Interrupted fixture posting");
  ok(await db.rpc("phase2_finish_shadow_recovery_job", { p_job_id: claim.job.id, p_succeeded: true, p_retryable: false,
    p_error_code: null, p_error_message: null }), "Interrupted fixture finish");
}

console.log("PHASE 2 AUTHORITATIVE COMPLETION AND RECOVERY DISPOSABLE E2E PASSED");
