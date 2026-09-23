import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.PHASE3_E2E_SUPABASE_URL;
const key = process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && key, "Disposable Supabase credentials are required.");
assert.equal(new URL(url).hostname.split(".")[0], "tangtlmdpnvmoviwrgvd", "Disposable project guard failed.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: candidates, error: customerError } = await db.from("customers").select("id,auth_user_id").limit(20);
assert.ifError(customerError);
let customer;
for (const candidate of candidates ?? []) {
  const state = await db.rpc("phase5_customer_state", { p_customer_id: candidate.id });
  assert.ifError(state.error);
  if (!state.data.membership_active && Number(state.data.available_credit_cents) === 0) { customer = candidate; break; }
}
assert.ok(customer, "A disposable non-member Customer without credit is required.");
const driverAccount = await db.from("driver_accounts").select("user_id,driver_id").not("driver_id", "is", null).limit(1).single();
assert.ifError(driverAccount.error);

const booked = await db.rpc("phase5_create_trip", {
  p_customer_id: customer.id,
  p_actor_id: customer.auth_user_id,
  p_booking_key: crypto.randomUUID(),
  p_trip_payload: {
    customer_id: customer.id, status: "requested", payment_method: "cash", ride_option: "go",
    pickup_address: "Disposable completion", dropoff_address: "Disposable completion",
    distance_km: 5, duration_min: 1, start_otp: "1111", end_otp: "2222",
  },
  p_ride_fare_cents: 10000,
  p_ride_option: "go",
  p_expected_customer_total_cents: 10300,
});
assert.ifError(booked.error);
const tripId = booked.data.trip.id;
const prepared = await db.from("trips").update({
  driver_id: driverAccount.data.driver_id,
  status: "ongoing",
  start_otp_verified: true,
  trip_started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
}).eq("id", tripId).select("financial_version").single();
assert.ifError(prepared.error);

const completionArgs = {
  p_trip_id: tripId,
  p_actor_id: driverAccount.data.user_id,
  p_expected_driver_id: driverAccount.data.driver_id,
  p_mode: "otp",
  p_otp: "2222",
  p_reason: null,
  p_note: null,
  p_expected_financial_version: Number(prepared.data.financial_version),
  p_expected_fare: 100,
  p_distance_audit: "Disposable validation",
};
const completed = await db.rpc("phase05b_complete_trip", completionArgs);
assert.ifError(completed.error);
assert.equal(completed.data.replayed, false);
assert.equal(Number(completed.data.driver_fare_basis), 100);
const replay = await db.rpc("phase05b_complete_trip", completionArgs);
assert.ifError(replay.error);
assert.equal(replay.data.replayed, true);

const transaction = await db.from("financial_transactions")
  .select("id,transaction_type,metadata")
  .eq("idempotency_key", `phase5:service-fee:${tripId}`).single();
assert.ifError(transaction.error);
assert.equal(transaction.data.transaction_type, "BOOKING_FEE");
assert.equal(transaction.data.metadata.cash_received_by_moovu, false);
const entries = await db.from("financial_ledger_entries")
  .select("entry_side,amount_cents").eq("transaction_id", transaction.data.id);
assert.ifError(entries.error);
assert.equal(entries.data.filter((row) => row.entry_side === "DEBIT").reduce((sum, row) => sum + Number(row.amount_cents), 0), 300);
assert.equal(entries.data.filter((row) => row.entry_side === "CREDIT").reduce((sum, row) => sum + Number(row.amount_cents), 0), 300);
const audit = await db.from("phase5_audit_events").select("id").eq("event_key", `service-fee-posted:${tripId}`);
assert.ifError(audit.error);
assert.equal(audit.data.length, 1);
console.log("PHASE 5 DISPOSABLE COMPLETION ACCOUNTING E2E PASSED");
