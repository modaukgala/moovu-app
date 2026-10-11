import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.PHASE3_E2E_SUPABASE_URL;
const anon = process.env.PHASE3_E2E_SUPABASE_ANON_KEY;
const service = process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.equal(new URL(url).hostname, "tangtlmdpnvmoviwrgvd.supabase.co");
assert.ok(anon && service && (process.env.GOOGLE_MAPS_SERVER_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY));
const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const base = "http://127.0.0.1:3591";
const run = randomUUID().slice(0, 8);
const password = randomUUID() + "Aa!";
const workerSecret = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
const scheduledEndpoint = process.env.DISPATCH_90S_HTTP_ENDPOINT;
const created = [];
const fixtureDrivers = [];
let server;
let scheduleStarted = false;
function required(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
async function account(role) {
  const email = `dispatch-90-${role}-${randomUUID()}@example.com`;
  const user = required(await db.auth.admin.createUser({ email, password, email_confirm: true }), "Create disposable auth").user;
  required(await db.from("profiles").upsert({ id: user.id, role }), "Disposable profile");
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const session = required(await client.auth.signInWithPassword({ email, password }), "Disposable login").session;
  return { id: user.id, token: session.access_token };
}
async function request(path, token, body, secret = false) {
  const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(secret ? { "x-dispatch-job-secret": workerSecret } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
try {
  const customer = await account("customer");
  const customerId = randomUUID();
  const phone = `+279${String(Date.now()).slice(-8)}`;
  required(await db.from("customers").insert({ id: customerId, auth_user_id: customer.id,
    first_name: "Dispatch", last_name: run, phone, normalized_phone: phone, status: "active" }), "Customer");
  for (let index = 0; index < 9; index++) {
    const driver = await account("driver");
    const driverId = randomUUID();
    required(await db.from("drivers").insert({ id: driverId, first_name: "Dispatch", last_name: run,
      phone: `+276${String(Date.now()).slice(-7)}${index}`, status: "approved", verification_status: "approved",
      profile_completed: true, online: true, busy: false, is_deleted: false, seating_capacity: 6,
      lat: -26.8 + index * 0.001, lng: 31.8, last_seen: new Date().toISOString(),
      subscription_status: "inactive" }), "Synthetic Driver");
    required(await db.from("driver_accounts").insert({ user_id: driver.id, driver_id: driverId }), "Driver account");
    required(await db.from("driver_wallets").insert({ driver_id: driverId, balance_due: 0 }), "Driver wallet");
    fixtureDrivers.push({ id: driverId, token: driver.token });
  }

  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service, DISPATCH_JOB_SECRET: workerSecret,
    MOOVU_DISPATCH_DISPOSABLE_E2E: "true",
    MOOVU_DISPATCH_90S_ENABLED: "true",
    MOOVU_DISPATCH_90S_EFFECTIVE_FROM: new Date(Date.now() - 60_000).toISOString(),
    MOOVU_PHASE2_FINANCE_MODE: "AUTHORITATIVE",
    NEXT_TELEMETRY_DISABLED: "1" };
  for (const name of Object.keys(env)) if (/FIREBASE|FCM|VAPID|RESEND|SMTP|YOCO|QSTASH/.test(name)) env[name] = "";
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", "3591"],
    { env, stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error("Disposable server exited");
    try { if ((await fetch(base)).status < 500) { ready = true; break; } } catch { /* startup */ }
    await delay(1000);
  }
  assert.ok(ready, "Disposable server ready");
  console.log("DISPOSABLE_90S_SERVER_READY");
  assert.equal((await request("/api/jobs/dispatch", null, {}, false)).status, 401);
  const route = await request("/api/maps/distance", customer.token, { origin_lat: -26.8, origin_lng: 31.8,
    destination_lat: -26.81, destination_lng: 31.81, waypoints: [] });
  assert.equal(route.status, 200, "Route quote available");
  const quote = await request("/api/customer/phase5-quote", customer.token, {
    pickup: { lat: -26.8, lng: 31.8 }, dropoff: { lat: -26.81, lng: 31.81 },
    stops: [], routeQuote: route.body.routeQuote, rideOption: "go" });
  assert.equal(quote.status, 200, "Canonical quote available");
  const payload = { pickupAddress: `Disposable dispatch ${run}`, dropoffAddress: "Disposable destination",
    pickupLat: -26.8, pickupLng: 31.8, dropoffLat: -26.81, dropoffLng: 31.81,
    stops: [], paymentMethod: "cash", distanceKm: route.body.distanceKm,
    durationMin: route.body.durationMin, originalDistanceKm: route.body.originalDistanceKm,
    originalDurationMin: route.body.originalDurationMin, routeQuote: route.body.routeQuote,
    rideType: "now", rideOption: "go", phase5ExpectedTotalCents: quote.body.quote.customerTotalCents,
    bookingKey: randomUUID() };
  const booked = await request("/api/customer/book-trip", customer.token, payload);
  assert.equal(booked.status, 200, JSON.stringify({ status: booked.status, error: booked.body?.error }));
  console.log("DISPOSABLE_90S_CASH_BOOKED");
  const tripId = booked.body.tripId;
  created.push(tripId);
  const window = required(await db.from("dispatch_matching_windows").select("*").eq("trip_id", tripId).single(), "Window");
  assert.equal(window.state, "SEARCHING");
  assert.equal(new Date(window.deadline_at).getTime() - new Date(window.started_at).getTime(), 90_000);
  let offers = required(await db.from("driver_trip_offers").select("id,driver_id,matching_step,status").eq("trip_id", tripId), "Offers");
  assert.equal(offers.length, 1);
  assert.equal(offers[0].matching_step, 0);
  assert.equal(offers[0].driver_id, fixtureDrivers[0].id, "Nearest synthetic Driver offered first");
  console.log("DISPOSABLE_90S_FIRST_OFFER_PASS");

  if (!scheduledEndpoint) await delay(11_000);
  const unrelatedBefore = required(await db.from("dispatch_jobs").select("id,status,attempts")
    .neq("trip_id", tripId).eq("status", "pending").lte("run_at", new Date().toISOString()), "Unrelated jobs before");
  const dueRecover = scheduledEndpoint ? [] : required(await db.from("dispatch_jobs").select("id")
    .eq("trip_id", tripId).eq("job_type", "recover").eq("status", "pending")
    .lte("run_at", new Date().toISOString()).limit(1), "Fixture recover job");
  if (!scheduledEndpoint) assert.equal(dueRecover.length, 1);
  if (!scheduledEndpoint && unrelatedBefore.length) {
    const blocked = await request("/api/jobs/dispatch", null,
      { disposableTestJobId: unrelatedBefore[0].id }, true);
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.processed, 0, "Non-synthetic job not claimed");
  }
  if (scheduledEndpoint) {
    const startedAt = new Date().toISOString();
    assert.equal(required(await db.rpc("start_disposable_dispatch_90s_trip_http_test", {
      p_trip_id: tripId, p_endpoint: scheduledEndpoint, p_token: workerSecret,
    }), "Start disposable HTTP cron"), true);
    scheduleStarted = true;
    let scheduledOffers = offers;
    let terminalState = "SEARCHING";
    const observations = [];
    while (Date.now() < new Date(window.deadline_at).getTime() + 50_000) {
      await delay(2000);
      scheduledOffers = required(await db.from("driver_trip_offers")
        .select("id,driver_id,matching_step,created_at")
        .eq("trip_id", tripId).order("created_at"), "Scheduled offers");
      const currentWindow = required(await db.from("dispatch_matching_windows")
        .select("state").eq("trip_id", tripId).single(), "Scheduled window");
      terminalState = currentWindow.state;
      if (observations.length !== scheduledOffers.length) {
        observations.push({ at: new Date().toISOString(), offerSteps: scheduledOffers.map(offer => offer.matching_step) });
      }
      if (terminalState !== "SEARCHING") break;
    }
    const offerSteps = scheduledOffers.map(offer => offer.matching_step).sort((a, b) => a - b);
    const offsetsMs = scheduledOffers.map(offer => Math.round(new Date(offer.created_at).getTime() -
      new Date(window.started_at).getTime()));
    const unrelatedAfter = required(await db.from("dispatch_jobs").select("id,status,attempts")
      .in("id", unrelatedBefore.map(job => job.id)), "Unrelated jobs after scheduled test");
    assert.deepEqual(unrelatedAfter.sort((a,b) => a.id.localeCompare(b.id)),
      unrelatedBefore.sort((a,b) => a.id.localeCompare(b.id)), "Unrelated queue unchanged");
    console.log(JSON.stringify({ status: "DISPOSABLE_SCHEDULED_FULL_WINDOW_OBSERVED",
      projectRef: "tangtlmdpnvmoviwrgvd", startedAt, tripId, offerSteps,
      offsetsMs, terminalState, observations, unrelatedQueuePreserved: true }));
    assert.deepEqual(offerSteps, [0,1,2,3,4,5,6,7,8], "Scheduled worker must cover every offer slot");
    assert.equal(terminalState, "UNMATCHED", "No-Driver terminal state persists");
    assert.equal(new Set(scheduledOffers.map(offer => offer.driver_id)).size, 9,
      "Each scheduled offer targets a distinct nearest eligible Driver");
  } else {
  const ticks = await Promise.all([
    request("/api/jobs/dispatch", null, { disposableTestJobId: dueRecover[0].id }, true),
    request("/api/jobs/dispatch", null, { disposableTestJobId: dueRecover[0].id }, true),
  ]);
  assert.ok(ticks.every(tick => tick.status === 200), "Authenticated worker ticks");
  assert.deepEqual(ticks.map(tick => tick.body.processed).sort(), [0, 1],
    "Concurrent workers claim the synthetic job exactly once");
  const unrelatedAfter = required(await db.from("dispatch_jobs").select("id,status,attempts")
    .in("id", unrelatedBefore.map(job => job.id)), "Unrelated jobs after");
  assert.deepEqual(unrelatedAfter.sort((a,b) => a.id.localeCompare(b.id)),
    unrelatedBefore.sort((a,b) => a.id.localeCompare(b.id)), "Unrelated queue unchanged");
  console.log("DISPOSABLE_90S_WORKER_TICK_PASS");
  const jobs = required(await db.from("dispatch_jobs").select("job_type,status").eq("trip_id", tripId), "Jobs");
  assert.ok(jobs.some(job => job.job_type === "recover"));
  const offerIdsBeforeCutoff = required(await db.from("driver_trip_offers").select("id,matching_step")
    .eq("trip_id", tripId), "Offers before cutoff");
  assert.deepEqual(offerIdsBeforeCutoff.map(offer => offer.matching_step).sort(), [0, 1]);
  for (let step = 2; step <= 8; step++) {
    const started = new Date(Date.now() - step * 10_000 - 250);
    required(await db.from("dispatch_matching_windows").update({ started_at: started.toISOString(),
      deadline_at: new Date(started.getTime() + 90_000).toISOString() })
      .eq("trip_id", tripId), `Advance fixture to step ${step}`);
    required(await db.from("dispatch_jobs").update({ run_at: new Date(Date.now() - 1000).toISOString() })
      .eq("trip_id", tripId).eq("job_type", "recover").eq("status", "pending"), `Due step ${step}`);
    const due = required(await db.from("dispatch_jobs").select("id")
      .eq("trip_id", tripId).eq("job_type", "recover").eq("status", "pending")
      .lte("run_at", new Date().toISOString()).limit(1), `Step ${step} job`);
    assert.equal(due.length, 1);
    const result = await request("/api/jobs/dispatch", null, { disposableTestJobId: due[0].id }, true);
    assert.equal(result.status, 200);
    assert.equal(result.body.processed, 1);
    const stepOffers = required(await db.from("driver_trip_offers").select("driver_id")
      .eq("trip_id", tripId).eq("matching_step", step), `Step ${step} offer`);
    assert.equal(stepOffers.length, 1);
    assert.equal(stepOffers[0].driver_id, fixtureDrivers[step].id);
  }
  const allSlotOffers = required(await db.from("driver_trip_offers").select("id,driver_id,matching_step")
    .eq("trip_id", tripId), "Nine matching slots");
  assert.deepEqual(allSlotOffers.map(offer => offer.matching_step).sort(), [0,1,2,3,4,5,6,7,8]);
  assert.equal(new Set(allSlotOffers.map(offer => offer.driver_id)).size, 9);
  console.log("DISPOSABLE_90S_NINE_SLOTS_PASS");

  // Advance only this synthetic window; the still-valid offer must survive the
  // matching cutoff before terminal resolution is allowed.
  const past = Date.now() - 91_000;
  required(await db.from("dispatch_matching_windows").update({ started_at: new Date(past).toISOString(),
    deadline_at: new Date(past + 90_000).toISOString() }).eq("trip_id", tripId), "Advance fixture clock");
  required(await db.from("dispatch_jobs").update({ run_at: new Date(Date.now() - 1000).toISOString() })
    .eq("trip_id", tripId).eq("status", "pending"), "Due fixture job");
  const cutoffJob = required(await db.from("dispatch_jobs").select("id")
    .eq("trip_id", tripId).eq("status", "pending").lte("run_at", new Date().toISOString())
    .order("run_at").limit(1), "Cutoff job")[0];
  assert.ok(cutoffJob);
  await request("/api/jobs/dispatch", null, { disposableTestJobId: cutoffJob.id }, true);
  offers = required(await db.from("driver_trip_offers").select("id,matching_step,status,accept_deadline_at")
    .eq("trip_id", tripId), "Offers after cutoff");
  assert.deepEqual(offers.map(offer => offer.id).sort(),
    allSlotOffers.map(offer => offer.id).sort(), "No new offer after cutoff");
  assert.ok(offers.some(offer => offer.status === "shown"), "Valid outstanding offer preserved");
  required(await db.from("driver_trip_offers").update({ accept_deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq("trip_id", tripId).in("status", ["pending", "shown"]), "Expire synthetic offers");
  required(await db.from("dispatch_jobs").update({ run_at: new Date(Date.now() - 1000).toISOString() })
    .eq("trip_id", tripId).eq("status", "pending"), "Due closure job");
  const closureJob = required(await db.from("dispatch_jobs").select("id")
    .eq("trip_id", tripId).eq("status", "pending").lte("run_at", new Date().toISOString())
    .order("run_at").limit(1), "Closure job")[0];
  assert.ok(closureJob);
  const closure = await request("/api/jobs/dispatch", null, { disposableTestJobId: closureJob.id }, true);
  assert.equal(closure.status, 200);
  const finalTrip = required(await db.from("trips").select("status,driver_id").eq("id", tripId).single(), "Final trip");
  const finalWindow = required(await db.from("dispatch_matching_windows").select("state").eq("trip_id", tripId).single(), "Final window");
  assert.equal(finalTrip.status, "cancelled");
  assert.equal(finalTrip.driver_id, null);
  assert.equal(finalWindow.state, "UNMATCHED");
  assert.equal(required(await db.from("online_payment_reconciliation_items").select("id")
    .eq("issue_type", "NO_DRIVER_MATCHING_TIMEOUT").contains("metadata", { trip_id: tripId }), "Cash reconciliation").length, 0);

  const secondPayload = { ...payload, bookingKey: randomUUID() };
  const secondBooking = await request("/api/customer/book-trip", customer.token, secondPayload);
  assert.equal(secondBooking.status, 200, "Synthetic concurrency booking");
  const concurrentTripId = secondBooking.body.tripId;
  created.push(concurrentTripId);
  const started = new Date(Date.now() - 11_250);
  required(await db.from("dispatch_matching_windows").update({ started_at: started.toISOString(),
    deadline_at: new Date(started.getTime() + 90_000).toISOString() })
    .eq("trip_id", concurrentTripId), "Advance concurrency fixture");
  required(await db.from("dispatch_jobs").update({ run_at: new Date(Date.now() - 1000).toISOString() })
    .eq("trip_id", concurrentTripId).eq("job_type", "recover").eq("status", "pending"), "Concurrency recovery due");
  const concurrentJob = required(await db.from("dispatch_jobs").select("id")
    .eq("trip_id", concurrentTripId).eq("job_type", "recover").eq("status", "pending")
    .lte("run_at", new Date().toISOString()).limit(1), "Concurrency job")[0];
  assert.ok(concurrentJob);
  assert.equal((await request("/api/jobs/dispatch", null,
    { disposableTestJobId: concurrentJob.id }, true)).body.processed, 1);
  const competingOffers = required(await db.from("driver_trip_offers")
    .select("driver_id,matching_step,status").eq("trip_id", concurrentTripId), "Competing offers");
  assert.deepEqual(competingOffers.map(offer => offer.matching_step).sort(), [0, 1]);
  const contenders = competingOffers.map(offer => fixtureDrivers.find(driver => driver.id === offer.driver_id));
  assert.ok(contenders.every(Boolean));
  const responses = await Promise.all(contenders.map(driver => request("/api/driver/offers/respond",
    driver.token, { tripId: concurrentTripId, action: "accept" })));
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  const assigned = required(await db.from("trips").select("status,driver_id")
    .eq("id", concurrentTripId).single(), "Concurrent assignment");
  assert.equal(assigned.status, "assigned");
  assert.ok(contenders.some(driver => driver.id === assigned.driver_id));
  const acceptedWindow = required(await db.from("dispatch_matching_windows").select("state,completed_at")
    .eq("trip_id", concurrentTripId).single(), "Accepted matching window");
  assert.equal(acceptedWindow.state, "MATCHED", "Accepted trip must end matching atomically");
  assert.ok(acceptedWindow.completed_at, "Matched window has terminal timestamp");
  assert.equal(required(await db.from("driver_trip_offers").select("id")
    .eq("trip_id", concurrentTripId).eq("status", "accepted"), "Accepted offers").length, 1);
  console.log("DISPOSABLE_90S_CONCURRENT_ACCEPTANCE_PASS");
  const admin = await account("owner");
  const assignedCancel = await request("/api/admin/trips/cancel", admin.token,
    { tripId: concurrentTripId, reason: "Controlled disposable matching lifecycle" });
  assert.equal(assignedCancel.status, 200, "Admin can cancel assigned synthetic trip");
  const matchedAfterCancel = required(await db.from("dispatch_matching_windows").select("state")
    .eq("trip_id", concurrentTripId).single(), "Matched window after cancellation");
  assert.equal(matchedAfterCancel.state, "MATCHED", "Later cancellation preserves matching outcome");
  assert.equal((await request("/api/admin/trips/cancel", admin.token,
    { tripId: concurrentTripId, reason: "Controlled disposable matching lifecycle" })).status, 200,
    "Duplicate Admin cancellation is idempotent");

  required(await db.from("drivers").update({ online: false, busy: false })
    .in("id", fixtureDrivers.map(driver => driver.id)), "Pause synthetic Drivers");
  required(await db.from("drivers").update({ online: true, last_seen: new Date().toISOString() })
    .eq("id", fixtureDrivers[2].id), "One online synthetic Driver");
  const lifecycleBooked = await request("/api/customer/book-trip", customer.token,
    { ...payload, bookingKey: randomUUID() });
  assert.equal(lifecycleBooked.status, 200, "Single-Driver lifecycle booking");
  const lifecycleTripId = lifecycleBooked.body.tripId;
  created.push(lifecycleTripId);
  let lifecycleOffers = required(await db.from("driver_trip_offers")
    .select("id,driver_id,matching_step,status").eq("trip_id", lifecycleTripId), "Single-Driver offer");
  assert.equal(lifecycleOffers.length, 1);
  assert.equal(lifecycleOffers[0].driver_id, fixtureDrivers[2].id);
  assert.equal((await request("/api/driver/offers/respond", fixtureDrivers[2].token,
    { tripId: lifecycleTripId, action: "reject" })).status, 200, "Explicit Driver decline");
  lifecycleOffers = required(await db.from("driver_trip_offers")
    .select("id,driver_id,matching_step,status").eq("trip_id", lifecycleTripId), "Declined offer history");
  assert.equal(lifecycleOffers.filter(offer => offer.status === "declined").length, 1);
  required(await db.from("drivers").update({ online: false })
    .eq("id", fixtureDrivers[2].id), "Driver goes offline");
  async function advanceLifecycle(step) {
    const started = new Date(Date.now() - step * 10_000 - 350);
    required(await db.from("dispatch_matching_windows").update({ started_at: started.toISOString(),
      deadline_at: new Date(started.getTime() + 90_000).toISOString() })
      .eq("trip_id", lifecycleTripId).eq("state", "SEARCHING"), `Lifecycle step ${step}`);
    required(await db.from("dispatch_jobs").update({ run_at: new Date(Date.now() - 1000).toISOString() })
      .eq("trip_id", lifecycleTripId).eq("job_type", "recover").eq("status", "pending"),
    `Due lifecycle step ${step}`);
    const due = required(await db.from("dispatch_jobs").select("id")
      .eq("trip_id", lifecycleTripId).eq("job_type", "recover").eq("status", "pending")
      .lte("run_at", new Date().toISOString()).limit(1), `Lifecycle job ${step}`)[0];
    assert.ok(due);
    const tick = await request("/api/jobs/dispatch", null, { disposableTestJobId: due.id }, true);
    assert.equal(tick.status, 200);
    assert.equal(tick.body.processed, 1);
  }
  await advanceLifecycle(1);
  assert.equal(required(await db.from("driver_trip_offers").select("id")
    .eq("trip_id", lifecycleTripId), "Offline/no-eligible offers").length, 1);
  required(await db.from("drivers").update({ online: true, last_seen: new Date().toISOString() })
    .eq("id", fixtureDrivers[3].id), "Driver becomes available");
  await advanceLifecycle(2);
  const newlyAvailable = required(await db.from("driver_trip_offers")
    .select("id,driver_id,matching_step,status").eq("trip_id", lifecycleTripId)
    .eq("matching_step", 2).single(), "Newly available Driver offer");
  assert.equal(newlyAvailable.driver_id, fixtureDrivers[3].id);
  required(await db.from("driver_trip_offers")
    .update({ accept_deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq("id", newlyAvailable.id), "Driver ignores offer until expiry");
  required(await db.rpc("expire_due_trip_offers", { p_trip_id: lifecycleTripId }), "Expire ignored offer");
  assert.equal(required(await db.from("driver_trip_offers").select("status")
    .eq("id", newlyAvailable.id).single(), "Ignored offer state").status, "expired");
  const quoteResponse = await request("/api/customer/cancellation-quote", customer.token,
    { tripId: lifecycleTripId });
  assert.equal(quoteResponse.status, 200, "Authoritative Customer cancellation quote");
  const customerCancel = await request("/api/customer/cancel-trip", customer.token,
    { tripId: lifecycleTripId, reason: "Testing the app",
      ...(quoteResponse.body.authority === "PHASE4" ? { quoteId: quoteResponse.body.quote.quote_id } : {}) });
  assert.equal(customerCancel.status, 200, "Customer cancellation during matching");
  assert.equal(required(await db.from("dispatch_matching_windows").select("state")
    .eq("trip_id", lifecycleTripId).single(), "Customer-cancelled window").state, "CANCELLED");
  const offersBeforeReplay = required(await db.from("driver_trip_offers").select("id")
    .eq("trip_id", lifecycleTripId), "Cancelled offers before worker replay").length;
  const staleWorker = await request("/api/jobs/dispatch", null,
    { disposableTestTripId: lifecycleTripId }, true);
  assert.equal(staleWorker.status, 200);
  assert.equal(required(await db.from("driver_trip_offers").select("id")
    .eq("trip_id", lifecycleTripId), "Cancelled offers after worker replay").length,
  offersBeforeReplay, "A stale worker cannot reopen cancelled matching");
  const adminBooked = await request("/api/customer/book-trip", customer.token,
    { ...payload, bookingKey: randomUUID() });
  assert.equal(adminBooked.status, 200, "Admin-cancel lifecycle booking");
  const adminCancelTripId = adminBooked.body.tripId;
  created.push(adminCancelTripId);
  assert.equal(required(await db.from("dispatch_matching_windows").select("state")
    .eq("trip_id", adminCancelTripId).single(), "Admin-cancel searching window").state, "SEARCHING");
  const adminSearchCancel = await request("/api/admin/trips/cancel", admin.token,
    { tripId: adminCancelTripId, reason: "Controlled disposable search cancellation" });
  assert.equal(adminSearchCancel.status, 200, "Admin cancellation during matching");
  assert.equal(required(await db.from("dispatch_matching_windows").select("state,completed_at")
    .eq("trip_id", adminCancelTripId).single(), "Admin-cancelled window").state, "CANCELLED");
  assert.equal((await request("/api/admin/trips/cancel", admin.token,
    { tripId: adminCancelTripId, reason: "Controlled disposable search cancellation" })).status, 200,
  "Duplicate Admin search cancellation is idempotent");
  console.log("DISPOSABLE_90S_DRIVER_LIFECYCLE_PASS");
  console.log(JSON.stringify({ status: "DISPOSABLE_CASH_MATCHING_PASS", projectRef: "tangtlmdpnvmoviwrgvd",
    tripId, firstOfferStep: 0, workerAuthorized: true, cutoffProtectedOffer: true,
    finalState: finalTrip.status, concurrentAssignment: assigned.driver_id }));
  }
} finally {
  if (scheduleStarted) {
    const stopped = await db.rpc("stop_disposable_dispatch_90s_http_test");
    if (stopped.error || stopped.data !== true) console.warn("Disposable HTTP schedule cleanup requires review");
  }
  for (const tripId of created) {
    const state = await db.from("trips").select("status,driver_id").eq("id", tripId).maybeSingle();
    if (!state.error && state.data && ["requested", "offered"].includes(state.data.status)
      && !state.data.driver_id) {
      const cutoff = new Date(Date.now() - 91_000);
      await db.from("driver_trip_offers").update({ accept_deadline_at: new Date(Date.now() - 1000).toISOString() })
        .eq("trip_id", tripId).in("status", ["pending", "shown"]);
      await db.from("dispatch_matching_windows").update({ started_at: cutoff.toISOString(),
        deadline_at: new Date(cutoff.getTime() + 90_000).toISOString() }).eq("trip_id", tripId);
      const settled = await db.rpc("finish_dispatch_matching_window", { p_trip_id: tripId });
      if (settled.error) console.warn("Synthetic trip cleanup requires review", { tripId });
    } else if (!state.error && state.data?.status === "assigned" &&
      fixtureDrivers?.some(driver => driver.id === state.data.driver_id)) {
      const cancelled = await db.from("trips").update({ status: "cancelled", cancelled_by: "system",
        cancel_reason: "Synthetic dispatch concurrency fixture cleanup",
        cancellation_reason: "Synthetic dispatch concurrency fixture cleanup",
        cancelled_at: new Date().toISOString() }).eq("id", tripId).eq("status", "assigned")
        .eq("driver_id", state.data.driver_id);
      if (cancelled.error) console.warn("Synthetic assigned trip cleanup requires review", { tripId });
      else {
        const terminal = required(await db.from("dispatch_matching_windows").select("state,completed_at")
          .eq("trip_id", tripId).single(), "Cancelled assigned window");
        assert.equal(terminal.state, "MATCHED", "Cancellation preserves the historical matched outcome");
        assert.ok(terminal.completed_at);
        await db.from("drivers").update({ busy: false }).eq("id", state.data.driver_id);
      }
    }
  }
  await db.from("drivers").update({ online: false }).eq("last_name", run).eq("first_name", "Dispatch");
  if (server && server.exitCode === null) {
    const stopped = new Promise(resolve => server.once("exit", resolve));
    server.kill();
    await Promise.race([stopped, delay(3000)]);
  }
}
