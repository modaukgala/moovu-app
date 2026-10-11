import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.PHASE3_E2E_SUPABASE_URL;
const anon = process.env.PHASE3_E2E_SUPABASE_ANON_KEY;
const service = process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.equal(new URL(url).hostname, "tangtlmdpnvmoviwrgvd.supabase.co");
assert.ok(anon && service);
const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const base = "http://127.0.0.1:3592";
const secretBytes = randomBytes(32);
const webhookSecret = `whsec_${secretBytes.toString("base64")}`;
const workerSecret = randomUUID() + randomUUID();
const run = randomUUID().slice(0, 8);
const password = randomUUID() + "Aa!";
const createdTrips = [];
let server;
const hash = value => createHash("sha256").update(value).digest("hex");
function required(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
async function post(path, body, headers = {}) {
  const response = await fetch(base + path, { method: "POST",
    headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function trip(customer, label) {
  const fareCents = 10000;
  const policy = required(await db.rpc("phase5_policy_at", { p_at: new Date().toISOString() }), "Fare policy");
  const serviceFee = Number(policy.go_service_fee_cents);
  const result = required(await db.rpc("phase5_create_trip", {
    p_customer_id: customer.customerId, p_actor_id: customer.authId,
    p_booking_key: randomUUID(), p_trip_payload: {
      customer_id: customer.customerId, status: "requested", payment_method: "online",
      ride_option: "go", pickup_address: `Synthetic paid matching ${run} ${label}`,
      dropoff_address: "Synthetic destination", pickup_lat: -26.8, pickup_lng: 31.8,
      dropoff_lat: -26.81, dropoff_lng: 31.81, distance_km: 2, duration_min: 5,
      start_otp: "1111", end_otp: "2222",
    }, p_ride_fare_cents: fareCents, p_ride_option: "go",
    p_expected_customer_total_cents: fareCents + serviceFee,
  }), "Canonical disposable online booking");
  createdTrips.push(result.trip.id);
  const amountCents = Math.round(Number(result.trip.fare_amount) * 100);
  const fareVersion = hash(JSON.stringify({ tripId: result.trip.id, amountCents, currency: "ZAR" }));
  const checkoutId = `checkout_dispatch_90_${randomUUID()}`;
  const attempt = required(await db.from("online_payment_attempts").insert({
    customer_id: customer.customerId, trip_id: result.trip.id, provider: "YOCO",
    provider_checkout_id: checkoutId, payment_method: "ONLINE", amount_cents: amountCents,
    currency: "ZAR", fare_version: fareVersion, locked_fare_snapshot: {
      tripId: result.trip.id, customerId: customer.customerId, amountCents,
      currency: "ZAR", source: "synthetic_disposable_checkout",
    }, state: "PENDING", idempotency_key: `disposable-dispatch-90:${result.trip.id}`,
    payload_hash: hash(`${result.trip.id}:${amountCents}`),
  }).select("id").single(), "Synthetic pending attempt");
  return { tripId: result.trip.id, attemptId: attempt.id, checkoutId, amountCents };
}
async function signedSuccess(payment) {
  const eventId = `event_dispatch_90_${randomUUID()}`;
  const raw = JSON.stringify({ id: eventId, type: "payment.succeeded", payload: {
    id: `payment_dispatch_90_${randomUUID()}`, type: "payment", status: "succeeded",
    amount: payment.amountCents, currency: "ZAR", mode: "test",
    metadata: { checkoutId: payment.checkoutId },
  } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const webhookId = randomUUID();
  const signature = createHmac("sha256", secretBytes).update(`${webhookId}.${timestamp}.${raw}`).digest("base64");
  const invoke = async () => {
    const response = await fetch(base + "/api/payments/yoco/webhook", { method: "POST",
      headers: { "Content-Type": "application/json", "webhook-id": webhookId,
        "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` }, body: raw });
    return { status: response.status, body: await response.json() };
  };
  return { first: await invoke(), replay: invoke, eventId };
}

try {
  const email = `dispatch-90-customer-${randomUUID()}@example.com`;
  const auth = required(await db.auth.admin.createUser({ email, password, email_confirm: true }), "Synthetic Auth").user;
  required(await db.from("profiles").upsert({ id: auth.id, role: "customer" }), "Synthetic profile");
  const customerId = randomUUID();
  const phone = `+279${String(Date.now()).slice(-8)}`;
  required(await db.from("customers").insert({ id: customerId, auth_user_id: auth.id,
    first_name: "Synthetic", last_name: run, phone, normalized_phone: phone, status: "active" }), "Synthetic Customer");
  const customer = { authId: auth.id, customerId };
  const failed = await trip(customer, "failed");
  required(await db.from("online_payment_attempts").update({ state: "FAILED" }).eq("id", failed.attemptId), "Failed attempt");
  const rejected = await db.rpc("start_dispatch_matching_window", { p_trip_id: failed.tripId });
  assert.ok(rejected.error, "Failed payment cannot start matching");
  assert.equal(required(await db.from("driver_trip_offers").select("id").eq("trip_id", failed.tripId), "Failed offers").length, 0);
  console.log("DISPOSABLE_FAILED_PAYMENT_DISPATCH_DENIED");

  const paid = await trip(customer, "paid");
  assert.ok((await db.rpc("start_dispatch_matching_window", { p_trip_id: paid.tripId })).error,
    "Pending payment cannot start matching");
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service, YOCO_WEBHOOK_SECRET: webhookSecret,
    YOCO_ENVIRONMENT: "test", YOCO_SECRET_KEY: "", DISPATCH_JOB_SECRET: workerSecret,
    MOOVU_DISPATCH_DISPOSABLE_E2E: "true", MOOVU_DISPATCH_90S_ENABLED: "true",
    MOOVU_DISPATCH_90S_EFFECTIVE_FROM: new Date(Date.now() - 60_000).toISOString(),
    MOOVU_PHASE2_FINANCE_MODE: "AUTHORITATIVE", NEXT_TELEMETRY_DISABLED: "1" };
  for (const name of Object.keys(env)) if (/FIREBASE|FCM|VAPID|RESEND|SMTP|QSTASH/.test(name)) env[name] = "";
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", "3592"],
    { env, stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error("Disposable server exited");
    try { if ((await fetch(base)).status < 500) { ready = true; break; } } catch { /* startup */ }
    await delay(1000);
  }
  assert.ok(ready, "Disposable server ready");
  const event = await signedSuccess(paid);
  assert.equal(event.first.status, 200, "Signed synthetic TEST webhook accepted");
  assert.equal(event.first.body.verified, true);
  assert.equal(event.first.body.dispatchPending, false, "Verified payment dispatched without browser return");
  const attempt = required(await db.from("online_payment_attempts")
    .select("state,verified_at,payment_ledger_transaction_id,dispatch_state")
    .eq("id", paid.attemptId).single(), "Verified attempt");
  assert.equal(attempt.state, "SUCCEEDED");
  assert.ok(attempt.verified_at && attempt.payment_ledger_transaction_id);
  assert.equal(attempt.dispatch_state, "DISPATCHED");
  const window = required(await db.from("dispatch_matching_windows").select("*")
    .eq("trip_id", paid.tripId).single(), "Paid matching window");
  assert.ok(new Date(window.started_at).getTime() >= new Date(attempt.verified_at).getTime());
  assert.equal(window.payment_attempt_id, paid.attemptId);
  assert.equal(required(await db.from("driver_trip_offers").select("id")
    .eq("trip_id", paid.tripId), "No-driver offers").length, 0);
  const replay = await event.replay();
  assert.equal(replay.status, 200, "Duplicate signed webhook acknowledged");
  assert.equal(required(await db.from("online_provider_events").select("id,trust_state,processing_state")
    .eq("provider_event_id", event.eventId), "Provider event").length, 1);
  console.log("DISPOSABLE_SIGNED_TEST_PAYMENT_DISPATCH_PASS");

  const cutoff = new Date(Date.now() - 91_000);
  required(await db.from("dispatch_matching_windows").update({ started_at: cutoff.toISOString(),
    deadline_at: new Date(cutoff.getTime() + 90_000).toISOString() })
    .eq("trip_id", paid.tripId), "Advance paid fixture clock");
  required(await db.from("dispatch_jobs").update({ run_at: new Date(Date.now() - 1000).toISOString() })
    .eq("trip_id", paid.tripId).eq("status", "pending"), "Due paid fixture job");
  const due = required(await db.from("dispatch_jobs").select("id").eq("trip_id", paid.tripId)
    .eq("status", "pending").lte("run_at", new Date().toISOString()).limit(1), "Due paid job");
  assert.equal(due.length, 1);
  const tick = await post("/api/jobs/dispatch", { disposableTestJobId: due[0].id },
    { "x-dispatch-job-secret": workerSecret });
  assert.equal(tick.status, 200);
  assert.equal(tick.body.processed, 1);
  const finalTrip = required(await db.from("trips").select("status,driver_id")
    .eq("id", paid.tripId).single(), "Final paid trip");
  assert.equal(finalTrip.status, "cancelled");
  assert.equal(finalTrip.driver_id, null);
  const item = required(await db.from("online_payment_reconciliation_items")
    .select("id,state,payment_attempt_id,expected_amount_cents,currency")
    .eq("payment_attempt_id", paid.attemptId).eq("issue_type", "NO_DRIVER_MATCHING_TIMEOUT"), "No-driver reconciliation");
  assert.equal(item.length, 1);
  assert.equal(item[0].state, "OPEN");
  assert.equal(Number(item[0].expected_amount_cents), paid.amountCents);
  assert.equal(item[0].currency, "ZAR");
  required(await db.rpc("finish_dispatch_matching_window", { p_trip_id: paid.tripId }), "Deadline replay");
  assert.equal(required(await db.from("online_payment_reconciliation_items").select("id")
    .eq("payment_attempt_id", paid.attemptId).eq("issue_type", "NO_DRIVER_MATCHING_TIMEOUT"), "Replay reconciliation").length, 1);
  assert.equal(required(await db.from("financial_transactions").select("id")
    .eq("id", attempt.payment_ledger_transaction_id), "Paid attempt ledger").length, 1);
  const entries = required(await db.from("financial_ledger_entries").select("entry_side,amount_cents")
    .eq("transaction_id", attempt.payment_ledger_transaction_id), "Paid ledger entries");
  assert.equal(entries.length, 2);
  assert.equal(entries.reduce((sum, entry) => sum + (entry.entry_side === "DEBIT"
    ? Number(entry.amount_cents) : -Number(entry.amount_cents)), 0), 0);
  console.log(JSON.stringify({ status: "DISPOSABLE_PAID_NO_DRIVER_PASS", projectRef: "tangtlmdpnvmoviwrgvd",
    paidTripId: paid.tripId, reconciliation: "OPEN", duplicateEvent: "REPLAYED" }));
} finally {
  for (const tripId of createdTrips) {
    const state = await db.from("trips").select("status,driver_id").eq("id", tripId).maybeSingle();
    if (!state.error && state.data && ["requested", "offered"].includes(state.data.status)
      && !state.data.driver_id) {
      const cutoff = new Date(Date.now() - 91_000);
      await db.from("driver_trip_offers").update({ accept_deadline_at: new Date(Date.now() - 1000).toISOString() })
        .eq("trip_id", tripId).in("status", ["pending", "shown"]);
      await db.from("dispatch_matching_windows").update({ started_at: cutoff.toISOString(),
        deadline_at: new Date(cutoff.getTime() + 90_000).toISOString() }).eq("trip_id", tripId);
      await db.rpc("finish_dispatch_matching_window", { p_trip_id: tripId });
    }
  }
  if (server && server.exitCode === null) {
    const stopped = new Promise(resolve => server.once("exit", resolve));
    server.kill();
    await Promise.race([stopped, delay(3000)]);
  }
}
