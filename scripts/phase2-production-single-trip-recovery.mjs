import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const tripId = "53f44a54-5605-42b4-8eea-7c83cf1e25ca";
const operationKey = `trip_commission:${tripId}`;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.PHASE2_RECOVERY_CRON_SECRET;
assert.ok(url && key && cronSecret, "Protected production recovery inputs are required.");
assert.equal(new URL(url).hostname.split(".")[0], "mvazbszenqahgqpznhhq", "Production project guard failed.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const required = (result, label) => { assert.ifError(result.error, label); return result.data; };

const policy = required(await db.from("phase2_finance_policy").select("mode,go_basis_points,debt_limit_cents,subscription_required").eq("policy_key", "phase2-driver-finance").single(), "Phase 2 policy");
assert.deepEqual(policy, { mode: "SHADOW", go_basis_points: 1500, debt_limit_cents: 5000, subscription_required: true });
const trip = required(await db.from("trips").select("id,status,driver_id,financial_version,fare_amount,final_fare").eq("id", tripId).single(), "Affected trip");
assert.equal(trip.status, "completed");
assert.equal(Number(trip.final_fare ?? trip.fare_amount), 117);
const event = required(await db.from("moovu_business_events").select("id,actor_id,payload").eq("event_key", `trip-complete:${tripId}`).single(), "Completion event");
assert.equal(event.payload.mode, "bypass");
const driverMapping = required(await db.from("driver_accounts").select("user_id").eq("driver_id", trip.driver_id).eq("user_id", event.actor_id).single(), "Original Driver authority");
assert.equal(driverMapping.user_id, event.actor_id);

async function counts() {
  const [legacy, transactions, reconciliations, events] = await Promise.all([
    db.from("driver_wallet_transactions").select("id,amount").eq("trip_id", tripId).eq("tx_type", "commission"),
    db.from("financial_transactions").select("id,currency,transaction_state").eq("idempotency_key", operationKey),
    db.from("phase2_shadow_reconciliations").select("id,legacy_amount_cents,ledger_amount_cents,parity").eq("operation_key", operationKey),
    db.from("moovu_business_events").select("id").eq("event_key", `trip-complete:${tripId}`),
  ]);
  [legacy, transactions, reconciliations, events].forEach((result) => assert.ifError(result.error));
  const entries = transactions.data.length === 0
    ? { data: [], error: null }
    : await db.from("financial_ledger_entries").select("id,entry_side,amount_cents,transaction_id").in("transaction_id", transactions.data.map((row) => row.id));
  assert.ifError(entries.error);
  return { legacy: legacy.data, transactions: transactions.data, entries: entries.data, reconciliations: reconciliations.data, events: events.data };
}

const before = await counts();
assert.equal(before.legacy.length, 1);
assert.equal(Math.round(Number(before.legacy[0].amount) * 100), 1170);
assert.equal(before.transactions.length, 0);
assert.equal(before.entries.length, 0);
assert.equal(before.reconciliations.length, 0);
assert.equal(before.events.length, 1);

const replayArgs = { p_trip_id: tripId, p_actor_id: event.actor_id, p_expected_driver_id: trip.driver_id,
  p_mode: "bypass", p_otp: null, p_reason: "Connectivity issue", p_note: null,
  p_expected_financial_version: Number(trip.financial_version), p_expected_fare: 117,
  p_distance_audit: "Authorized Phase 2 durable shadow recovery" };
const replay = required(await db.rpc("phase05b_complete_trip", replayArgs), "Authorized completion replay");
assert.equal(replay.replayed, true);
const queued = required(await db.from("phase2_shadow_recovery_jobs").select("status,attempts").eq("operation_key", operationKey).single(), "Recovery queue");
assert.equal(queued.status, "pending");

async function runWorker() {
  const response = await fetch("https://moovurides.co.za/api/jobs/phase2-shadow-recovery", { headers: { authorization: `Bearer ${cronSecret}` } });
  assert.equal(response.status, 200);
  return response.json();
}
const firstWorker = await runWorker();
assert.equal(firstWorker.ok, true);
assert.equal(firstWorker.processed, 1);
assert.equal(firstWorker.results[0].ok, true);

const after = await counts();
assert.equal(after.legacy.length, 1);
assert.equal(Math.round(Number(after.legacy[0].amount) * 100), 1170);
assert.equal(after.transactions.length, 1);
assert.deepEqual({ currency: after.transactions[0].currency, state: after.transactions[0].transaction_state }, { currency: "ZAR", state: "POSTED" });
assert.equal(after.entries.length, 2);
assert.equal(after.entries.filter((row) => row.entry_side === "DEBIT").reduce((sum, row) => sum + Number(row.amount_cents), 0), 1755);
assert.equal(after.entries.filter((row) => row.entry_side === "CREDIT").reduce((sum, row) => sum + Number(row.amount_cents), 0), 1755);
assert.equal(after.reconciliations.length, 1);
assert.equal(Number(after.reconciliations[0].legacy_amount_cents), 1170);
assert.equal(Number(after.reconciliations[0].ledger_amount_cents), 1755);
assert.equal(after.events.length, 1);

const secondReplay = required(await db.rpc("phase05b_complete_trip", replayArgs), "Harmless completion replay");
assert.equal(secondReplay.replayed, true);
const secondWorker = await runWorker();
assert.equal(secondWorker.ok, true);
assert.equal(secondWorker.processed, 0);
const final = await counts();
assert.deepEqual({ legacy: final.legacy.length, transactions: final.transactions.length, entries: final.entries.length,
  reconciliations: final.reconciliations.length, events: final.events.length }, { legacy: 1, transactions: 1, entries: 2, reconciliations: 1, events: 1 });

console.log("PHASE 2 AUTHORIZED SINGLE-TRIP PRODUCTION RECOVERY PASSED");
