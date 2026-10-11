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
const base = "http://127.0.0.1:3595";
const run = randomUUID().slice(0, 8);
const password = randomUUID() + "Aa!";
const workerSecret = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
const webhookBytes = randomBytes(32);
const webhookSecret = `whsec_${webhookBytes.toString("base64")}`;
const pickup = { lat: -26.8, lng: 31.8 };
const trips = [];
const drivers = [];
let server;
const hash = value => createHash("sha256").update(value).digest("hex");
function required(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
async function account(role) {
  const email = `dispatch-90-${role}-${randomUUID()}@example.com`;
  const user = required(await db.auth.admin.createUser({ email, password, email_confirm: true }), "Synthetic Auth").user;
  required(await db.from("profiles").upsert({ id: user.id, role }), "Synthetic profile");
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const session = required(await client.auth.signInWithPassword({ email, password }), "Synthetic sign-in").session;
  return { id: user.id, token: session.access_token };
}
async function post(path, body, headers = {}) {
  const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function createDriver(index, lat) {
  const auth = await account("driver");
  const id = randomUUID();
  required(await db.from("drivers").insert({ id, first_name: "Fairness", last_name: run,
    phone: `+276${String(Date.now()).slice(-7)}${index}`, status: "approved", verification_status: "approved",
    profile_completed: true, online: true, busy: false, is_deleted: false, seating_capacity: 6,
    lat, lng: pickup.lng, last_seen: new Date().toISOString(), subscription_status: "inactive" }), "Synthetic Driver");
  required(await db.from("driver_accounts").insert({ user_id: auth.id, driver_id: id }), "Driver account");
  required(await db.from("driver_wallets").insert({ driver_id: id, balance_due: 0 }), "Driver wallet");
  drivers.push({ id, token: auth.token });
  return drivers.at(-1);
}
async function createTrip(customer, method, label) {
  const fareCents = 10000;
  const policy = required(await db.rpc("phase5_policy_at", { p_at: new Date().toISOString() }), "Fare policy");
  const serviceFee = Number(policy.go_service_fee_cents);
  const result = required(await db.rpc("phase5_create_trip", {
    p_customer_id: customer.customerId, p_actor_id: customer.authId, p_booking_key: randomUUID(),
    p_trip_payload: { customer_id: customer.customerId, status: "requested", payment_method: method,
      ride_option: "go", pickup_address: `Synthetic fairness ${run} ${label}`,
      dropoff_address: "Synthetic destination", pickup_lat: pickup.lat, pickup_lng: pickup.lng,
      dropoff_lat: pickup.lat + 0.01, dropoff_lng: pickup.lng + 0.01,
      distance_km: 2, duration_min: 5, start_otp: "1111", end_otp: "2222" },
    p_ride_fare_cents: fareCents, p_ride_option: "go",
    p_expected_customer_total_cents: fareCents + serviceFee,
  }), `Canonical ${method} booking`);
  trips.push(result.trip.id);
  return { id: result.trip.id, amountCents: Math.round(Number(result.trip.fare_amount) * 100),
    fareAmount: Number(result.trip.fare_amount) };
}
async function dispatchCash(trip) {
  required(await db.from("dispatch_jobs").upsert({ trip_id: trip.id, job_type: "recover",
    run_at: new Date(Date.now() - 1000).toISOString(), dispatch_cycle: 1, sequence_number: 1,
    status: "pending", updated_at: new Date().toISOString() },
  { onConflict: "trip_id,job_type,dispatch_cycle,sequence_number", ignoreDuplicates: true }), "Enqueue Cash dispatch");
  const job = required(await db.from("dispatch_jobs").select("id").eq("trip_id", trip.id)
    .eq("job_type", "recover").eq("status", "pending").limit(1).single(), "Cash job");
  const tick = await post("/api/jobs/dispatch", { disposableTestJobId: job.id },
    { "x-dispatch-job-secret": workerSecret });
  assert.equal(tick.status, 200);
  assert.equal(tick.body.processed, 1);
  const replay = await post("/api/jobs/dispatch", { disposableTestJobId: job.id },
    { "x-dispatch-job-secret": workerSecret });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.processed, 0, "Worker replay cannot duplicate the Cash offer");
}
async function dispatchPaid(customer, trip) {
  const checkoutId = `checkout_fairness_${randomUUID()}`;
  const attempt = required(await db.from("online_payment_attempts").insert({
    customer_id: customer.customerId, trip_id: trip.id, provider: "YOCO", provider_checkout_id: checkoutId,
    payment_method: "ONLINE", amount_cents: trip.amountCents, currency: "ZAR",
    fare_version: hash(JSON.stringify({ tripId: trip.id, amountCents: trip.amountCents, currency: "ZAR" })),
    locked_fare_snapshot: { tripId: trip.id, customerId: customer.customerId,
      amountCents: trip.amountCents, currency: "ZAR", source: "synthetic_disposable_checkout" },
    state: "PENDING", idempotency_key: `disposable-fairness:${trip.id}`,
    payload_hash: hash(`${trip.id}:${trip.amountCents}`),
  }).select("id").single(), "Synthetic pending online attempt");
  const eventId = `event_fairness_${randomUUID()}`;
  const raw = JSON.stringify({ id: eventId, type: "payment.succeeded", payload: {
    id: `payment_fairness_${randomUUID()}`, type: "payment", status: "succeeded",
    amount: trip.amountCents, currency: "ZAR", mode: "test", metadata: { checkoutId },
  } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const webhookId = randomUUID();
  const signature = createHmac("sha256", webhookBytes).update(`${webhookId}.${timestamp}.${raw}`).digest("base64");
  const headers = { "Content-Type": "application/json", "webhook-id": webhookId,
    "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` };
  const invoke = async () => {
    const response = await fetch(base + "/api/payments/yoco/webhook", { method: "POST", headers, body: raw });
    return { status: response.status, body: await response.json() };
  };
  const first = await invoke();
  assert.equal(first.status, 200);
  assert.equal(first.body.verified, true);
  assert.equal(first.body.dispatchPending, false);
  assert.equal((await invoke()).status, 200, "Webhook replay is idempotent");
  const settled = required(await db.from("online_payment_attempts").select("state,verified_at")
    .eq("id", attempt.id).single(), "Verified synthetic attempt");
  assert.equal(settled.state, "SUCCEEDED");
  assert.ok(settled.verified_at);
  return attempt.id;
}
async function offer(trip) {
  return required(await db.from("driver_trip_offers").select("id,driver_id,matching_step,status")
    .eq("trip_id", trip.id).order("created_at"), "Trip offers");
}
async function terminalNoDriver(trip, paidAttemptId = null) {
  const old = new Date(Date.now() - 91_000);
  required(await db.from("driver_trip_offers").update({ accept_deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq("trip_id", trip.id).in("status", ["pending", "shown"]), "Expire controlled offers");
  required(await db.from("dispatch_matching_windows").update({ started_at: old.toISOString(),
    deadline_at: new Date(old.getTime() + 90_000).toISOString() })
    .eq("trip_id", trip.id).eq("state", "SEARCHING"), "Advance controlled matching clock");
  const result = required(await db.rpc("finish_dispatch_matching_window", { p_trip_id: trip.id }), "Terminal closure");
  assert.equal(result.changed, true);
  const replay = required(await db.rpc("finish_dispatch_matching_window", { p_trip_id: trip.id }), "Terminal replay");
  assert.equal(replay.replayed, true);
  assert.equal(required(await db.from("dispatch_matching_windows").select("state")
    .eq("trip_id", trip.id).single(), "Terminal window").state, "UNMATCHED");
  const items = required(await db.from("online_payment_reconciliation_items").select("id")
    .contains("metadata", { trip_id: trip.id }).eq("issue_type", "NO_DRIVER_MATCHING_TIMEOUT"), "No-driver items");
  assert.equal(items.length, paidAttemptId ? 1 : 0);
  if (paidAttemptId) assert.equal(required(await db.from("online_payment_reconciliation_items").select("id")
    .eq("payment_attempt_id", paidAttemptId).eq("issue_type", "NO_DRIVER_MATCHING_TIMEOUT"),
  "Paid reconciliation replay").length, 1);
}

try {
  const customerAuth = await account("customer");
  const customerId = randomUUID();
  const phone = `+279${String(Date.now()).slice(-8)}`;
  required(await db.from("customers").insert({ id: customerId, auth_user_id: customerAuth.id,
    first_name: "Fairness", last_name: run, phone, normalized_phone: phone, status: "active" }), "Synthetic Customer");
  const customer = { authId: customerAuth.id, customerId };
  const near = await createDriver(0, pickup.lat);
  const mid = await createDriver(1, pickup.lat + 0.09); // ~10 km: paid step 0, outside Cash step 0.
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service, YOCO_WEBHOOK_SECRET: webhookSecret, YOCO_ENVIRONMENT: "test",
    YOCO_SECRET_KEY: "", DISPATCH_JOB_SECRET: workerSecret, MOOVU_DISPATCH_DISPOSABLE_E2E: "true",
    MOOVU_DISPATCH_90S_ENABLED: "true",
    MOOVU_DISPATCH_90S_EFFECTIVE_FROM: new Date(Date.now() - 60_000).toISOString(),
    MOOVU_PHASE2_FINANCE_MODE: "AUTHORITATIVE", NEXT_TELEMETRY_DISABLED: "1" };
  for (const name of Object.keys(env)) if (/FIREBASE|FCM|VAPID|RESEND|SMTP|QSTASH/.test(name)) env[name] = "";
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", "3595"],
    { env, stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error("Disposable app server exited");
    try { if ((await fetch(base)).status < 500) { ready = true; break; } } catch { /* startup */ }
    await delay(1000);
  }
  assert.ok(ready, "Disposable app server ready");
  assert.equal((await post("/api/jobs/dispatch", {}, {})).status, 401, "Worker authentication required");
  const unrelatedBefore = required(await db.from("dispatch_jobs").select("id,status,attempts")
    .eq("status", "pending").lte("run_at", new Date().toISOString()), "Unrelated queue baseline");
  const cash = await createTrip(customer, "cash", "cash-first");
  await dispatchCash(cash);
  assert.equal((await offer(cash))[0]?.driver_id, near.id, "Cash receives nearest eligible Driver");
  const paid = await createTrip(customer, "online", "paid-after-cash");
  const paidAttempt = await dispatchPaid(customer, paid);
  assert.equal((await offer(paid))[0]?.driver_id, mid.id, "Paid bounded 14 km radius reaches next eligible Driver");
  assert.equal((await offer(cash)).length, 1, "Paid dispatch does not steal Cash offer");
  assert.equal((await post("/api/driver/offers/respond", { tripId: cash.id, action: "accept" },
    { Authorization: `Bearer ${near.token}` })).status, 200, "Cash Driver accepts");
  assert.equal((await post("/api/driver/offers/respond", { tripId: paid.id, action: "accept" },
    { Authorization: `Bearer ${near.token}` })).status !== 200, true,
  "Driver cannot accept overlapping trip without an offer");
  assert.equal((await post("/api/driver/offers/respond", { tripId: paid.id, action: "accept" },
    { Authorization: `Bearer ${mid.token}` })).status, 200, "Paid Driver accepts");
  assert.equal((await post("/api/driver/offers/respond", { tripId: cash.id, action: "accept" },
    { Authorization: `Bearer ${mid.token}` })).status !== 200, true, "Accepted Cash trip cannot be stolen");
  for (const [trip, driver] of [[cash, near], [paid, mid]]) {
    const assigned = required(await db.from("trips").select("status,driver_id,fare_amount")
      .eq("id", trip.id).single(), "Accepted assignment");
    assert.equal(assigned.status, "assigned");
    assert.equal(assigned.driver_id, driver.id);
    assert.equal(Number(assigned.fare_amount), trip.fareAmount, "Locked fare unchanged");
    assert.equal(required(await db.from("dispatch_matching_windows").select("state")
      .eq("trip_id", trip.id).single(), "Matched window").state, "MATCHED");
  }
  console.log("DISPOSABLE_PAID_CASH_FIRST_PAIR_PASS");

  const nearPaid = await createDriver(2, pickup.lat + 0.01);
  const nearCash = await createDriver(3, pickup.lat + 0.02);
  const paidFirst = await createTrip(customer, "online", "paid-first");
  const paidFirstAttempt = await dispatchPaid(customer, paidFirst);
  assert.equal((await offer(paidFirst))[0]?.driver_id, nearPaid.id, "Paid receives nearest free Driver");
  const cashAfter = await createTrip(customer, "cash", "cash-after-paid");
  await dispatchCash(cashAfter);
  assert.equal((await offer(cashAfter))[0]?.driver_id, nearCash.id,
    "Cash still receives an eligible Driver while paid offer is outstanding");
  await terminalNoDriver(paidFirst, paidFirstAttempt);
  await terminalNoDriver(cashAfter);
  assert.equal(required(await db.from("online_payment_reconciliation_items").select("id")
    .eq("payment_attempt_id", paidAttempt).eq("issue_type", "NO_DRIVER_MATCHING_TIMEOUT"),
  "Accepted paid trip no-driver item").length, 0);
  const unrelatedAfter = required(await db.from("dispatch_jobs").select("id,status,attempts")
    .in("id", unrelatedBefore.map(job => job.id)), "Unrelated queue after fairness test");
  assert.deepEqual(unrelatedAfter.sort((a,b) => a.id.localeCompare(b.id)),
    unrelatedBefore.sort((a,b) => a.id.localeCompare(b.id)), "Unrelated queue unchanged");
  console.log(JSON.stringify({ status: "DISPOSABLE_PAID_CASH_FAIRNESS_PASS",
    projectRef: "tangtlmdpnvmoviwrgvd", paidRadiusKm: 14, cashRadiusKm: 8,
    paidAndCashBothOffered: true, acceptedAssignmentsStable: true,
    bothDeadlineOutcomes: "UNMATCHED", unrelatedQueueTouched: false }));
} finally {
  for (const tripId of trips) {
    const state = await db.from("trips").select("status,driver_id").eq("id", tripId).maybeSingle();
    if (!state.error && state.data && ["requested", "offered"].includes(state.data.status)
      && !state.data.driver_id) {
      const cutoff = new Date(Date.now() - 91_000);
      await db.from("driver_trip_offers").update({ accept_deadline_at: new Date(Date.now() - 1000).toISOString() })
        .eq("trip_id", tripId).in("status", ["pending", "shown"]);
      await db.from("dispatch_matching_windows").update({ started_at: cutoff.toISOString(),
        deadline_at: new Date(cutoff.getTime() + 90_000).toISOString() }).eq("trip_id", tripId).eq("state", "SEARCHING");
      await db.rpc("finish_dispatch_matching_window", { p_trip_id: tripId });
    } else if (!state.error && state.data?.status === "assigned" &&
      drivers.some(driver => driver.id === state.data.driver_id)) {
      await db.from("trips").update({ status: "cancelled", cancelled_by: "system",
        cancel_reason: "Disposable fairness fixture cleanup",
        cancellation_reason: "Disposable fairness fixture cleanup", cancelled_at: new Date().toISOString() })
        .eq("id", tripId).eq("status", "assigned").eq("driver_id", state.data.driver_id);
    }
  }
  if (drivers.length) await db.from("drivers").update({ online: false, busy: false })
    .in("id", drivers.map(driver => driver.id));
  if (server && server.exitCode === null) {
    const stopped = new Promise(resolve => server.once("exit", resolve));
    server.kill();
    await Promise.race([stopped, delay(3000)]);
  }
}
