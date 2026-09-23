import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.PHASE3_E2E_SUPABASE_URL;
const anon = process.env.PHASE3_E2E_SUPABASE_ANON_KEY;
const service = process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && anon && service, "Disposable credentials required");
assert.equal(new URL(url).hostname, "tangtlmdpnvmoviwrgvd.supabase.co", "Disposable guard");
const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const password = `${randomUUID()}Aa!`;
const checks = [];
const drivers = [];
const trips = [];
const base = "http://127.0.0.1:3586";
let server;
let logs = "";
function required(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
function check(name, pass, details = null) {
  checks.push({ name, pass: Boolean(pass), details });
  console.log(JSON.stringify(checks.at(-1)));
}
async function user(role) {
  const email = `booking-repair-${role}-${randomUUID()}@example.com`;
  const created = required(await db.auth.admin.createUser({ email, password, email_confirm: true }), "Auth fixture").user;
  required(await db.from("profiles").upsert({ id: created.id, role }), "Profile fixture");
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = required(await auth.auth.signInWithPassword({ email, password }), "Password login");
  return { id: created.id, token: signed.session.access_token };
}
async function request(path, token, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function driver(subscribed, offset) {
  const account = await user("driver");
  const id = randomUUID();
  required(await db.from("drivers").insert({ id, first_name: "Booking repair", last_name: run,
    status: "approved", verification_status: "approved", profile_completed: true,
    online: true, busy: false, is_deleted: false, seating_capacity: 6,
    lat: -25.4800 + offset, lng: 28.6800, last_seen: new Date().toISOString(),
    subscription_status: subscribed ? "active" : "expired",
    subscription_expires_at: subscribed ? new Date(Date.now() + 86400000).toISOString() : null }), "Driver fixture");
  required(await db.from("driver_accounts").insert({ user_id: account.id, driver_id: id }), "Driver mapping");
  required(await db.from("driver_wallets").insert({ driver_id: id, balance_due: 0 }), "Wallet fixture");
  const result = { ...account, driverId: id };
  drivers.push(result);
  return result;
}
async function offers(tripId) {
  return required(await db.from("driver_trip_offers").select("*").eq("trip_id", tripId).order("created_at"), "Offer history");
}
async function financialCount(tripId) {
  return required(await db.from("financial_transactions").select("id,transaction_type,transaction_state").eq("economic_trip_id", tripId), "Trip ledger");
}
try {
  const policy = required(await db.rpc("phase2_current_policy"), "Finance policy");
  check("Authoritative policy", policy.mode === "AUTHORITATIVE" && Number(policy.go_basis_points) === 1500 &&
    Number(policy.go_xl_basis_points) === 1500 && Number(policy.debt_limit_cents) === 5000 && policy.subscription_required === false, policy);
  const customer = await user("customer");
  const admin = await user("admin");
  const customerId = randomUUID();
  required(await db.from("customers").insert({ id: customerId, auth_user_id: customer.id, first_name: "Booking", last_name: run,
    phone: `+279${String(Date.now()).slice(-8)}`, status: "active" }), "Customer fixture");
  const state = required(await db.rpc("phase5_customer_state", { p_customer_id: customerId }), "Customer benefits");
  assert.equal(state.membership_active, false);
  assert.equal(Number(state.available_credit_cents), 0);
  const nearest = await driver(false, 0);
  await driver(true, 0.001);
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service, MOOVU_PHASE2_FINANCE_MODE: "AUTHORITATIVE" };
  // Prevent any delivery through production Firebase/Web Push/email credentials.
  for (const name of Object.keys(env)) if (/FIREBASE|FCM|VAPID|GOOGLE_APPLICATION_CREDENTIALS|RESEND|SMTP|QSTASH/.test(name)) env[name] = "";
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", "3586"], { env, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { logs += chunk.toString(); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${logs.slice(-3000)}`);
    try { if ((await fetch(base)).status < 500) { ready = true; break; } } catch { /* server startup */ }
    await delay(1000);
  }
  assert.ok(ready, "Server startup");
  check("Unauthenticated booking blocked", (await request("/api/customer/book-trip", null, {})).status === 401);
  await request("/api/admin/trips/auto-assign", null, {});
  await request("/api/driver/offers/respond", null, {});
  const route = await request("/api/maps/distance", customer.token, { origin_lat: -25.4800, origin_lng: 28.6800,
    destination_lat: -25.4850, destination_lng: 28.7000, waypoints: [] });
  assert.equal(route.status, 200, JSON.stringify(route.body));
  const quote = await request("/api/customer/phase5-quote", customer.token, { pickup: { lat: -25.4800, lng: 28.6800 },
    dropoff: { lat: -25.4850, lng: 28.7000 }, stops: [], routeQuote: route.body.routeQuote, rideOption: "go" });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.authority, "PHASE5");
  const payload = { pickupAddress: `Booking repair ${run}`, dropoffAddress: "Disposable destination", pickupLat: -25.4800,
    pickupLng: 28.6800, dropoffLat: -25.4850, dropoffLng: 28.7000, stops: [], paymentMethod: "cash",
    distanceKm: route.body.distanceKm, durationMin: route.body.durationMin,
    originalDistanceKm: route.body.originalDistanceKm, originalDurationMin: route.body.originalDurationMin,
    routeQuote: route.body.routeQuote, rideType: "now", rideOption: "go",
    phase5ExpectedTotalCents: quote.body.quote.customerTotalCents, bookingKey: randomUUID() };
  const booked = await request("/api/customer/book-trip", customer.token, payload);
  check("Authenticated Cash/Transfer Go HTTP booking", booked.status === 200, { status: booked.status, tripId: booked.body?.tripId, error: booked.body?.error });
  assert.equal(booked.status, 200, JSON.stringify(booked.body));
  const tripId = booked.body.tripId;
  trips.push(tripId);
  const trip = required(await db.from("trips").select("*").eq("id", tripId).single(), "Created trip");
  check("Required omitted defaults", Array.isArray(trip.offer_attempted_driver_ids) && trip.offer_attempted_driver_ids.length === 0 &&
    trip.issue_reported === false && Number(trip.cancellation_fee_amount) === 0 && Number(trip.dispatch_priority_score) === 0 &&
    trip.completed_without_end_otp === false && Boolean(trip.id && trip.created_at), {
    attempted: trip.offer_attempted_driver_ids, issue: trip.issue_reported, cancellation: trip.cancellation_fee_amount,
    priority: trip.dispatch_priority_score, bypass: trip.completed_without_end_otp });
  check("Go 15% locked snapshot", Number(trip.commission_basis_points) === 1500 && Boolean(trip.commission_locked_at));
  let history = await offers(tripId);
  check("First database offer generated", history.length === 1, history.map(row => ({ id: row.id, driver: row.driver_id, status: row.status })));
  check("Durable offer expiry job saved", required(await db.from("dispatch_jobs").select("id").eq("trip_id", tripId).eq("job_type", "expire"), "Expiry job").length === 1);
  check("No-subscription nearest driver can receive work", history.some(row => row.driver_id === nearest.driverId));
  check("Attempted driver persisted in offer history", history.length > 0 && history.every(row => Boolean(row.driver_id)));
  check("Legacy attempted array records offered driver", history.length > 0 && history.every(row => trip.offer_attempted_driver_ids.includes(row.driver_id)));
  check("No premature ledger/economic commission", (await financialCount(tripId)).length === 0 &&
    required(await db.from("driver_wallet_transactions").select("id").eq("trip_id", tripId), "Legacy ledger").length === 0 &&
    required(await db.from("moovu_business_events").select("id").eq("event_key", `trip-complete:${tripId}`), "Completion events").length === 0);
  const replay = await request("/api/customer/book-trip", customer.token, payload);
  check("Booking retry returns same trip", replay.status === 200 && replay.body?.tripId === tripId);
  check("Booking retry duplicates no offer or ledger", (await offers(tripId)).length === history.length && (await financialCount(tripId)).length === 0);
  const failed = await request("/api/customer/book-trip", customer.token, { ...payload, bookingKey: randomUUID(), rideType: "scheduled",
    scheduledFor: new Date(Date.now() + 1800000).toISOString() });
  check("Constraint failure sanitized", failed.status === 500 && failed.body?.error === "We couldn't create your trip. Please try again.", failed);
  check("Failure diagnostics remain server-side", /\[book-trip\] trip creation failed/.test(logs) && /23514/.test(logs));
  console.log("SERVER_FAILURE_DIAGNOSTICS " + logs.split("\n").filter(line => /book-trip.*failed|code: '23514'|check constraint/.test(line)).join(" | "));
  if (history.length) {
    required(await db.from("driver_trip_offers").update({ accept_deadline_at: new Date(Date.now() - 1000).toISOString(),
      visible_until: new Date(Date.now() - 1000).toISOString(), escalates_at: new Date(Date.now() - 1000).toISOString() }).eq("id", history[0].id), "Scoped expiry fixture");
    const retried = await request("/api/admin/trips/auto-assign", admin.token, { tripId });
    history = await offers(tripId);
    check("Expired offer reoffered", retried.status === 200 && history.length >= 2 && history[0].status === "expired", { retried, statuses: history.map(row => row.status) });
    const current = history.at(-1);
    const owner = drivers.find(row => row.driverId === current.driver_id);
    if (owner && current.status === "shown") {
      const decline = await request("/api/driver/offers/respond", owner.token, { tripId, action: "reject" });
      await request("/api/admin/trips/auto-assign", admin.token, { tripId });
      const afterDecline = await offers(tripId);
      check("Declined driver excluded from reoffer", decline.status === 200 && !afterDecline.some(row => row.driver_id === owner.driverId && row.status === "shown"), { decline });
    }
  }
  const zero = required(await db.rpc("phase2_finance_eligibility", { p_driver_id: nearest.driverId }), "Zero debt eligibility");
  check("No-subscription zero debt finance eligible", zero.authoritative_eligible === true && zero.subscription_required === false, zero);
  const farePolicy = required(await db.rpc("phase5_policy_at", { p_at: new Date().toISOString() }), "Fare policy");
  async function completedCommission(rideOption, label, fareCents = 10000) {
    const serviceFee = Number(rideOption === "group" ? farePolicy.go_xl_service_fee_cents : farePolicy.go_service_fee_cents);
    const result = required(await db.rpc("phase5_create_trip", { p_customer_id: customerId, p_actor_id: customer.id,
      p_booking_key: randomUUID(), p_trip_payload: { customer_id: customerId, status: "requested", payment_method: "cash", ride_option: rideOption,
        pickup_address: `Booking repair auxiliary ${run} ${label}`, dropoff_address: "Disposable finish", distance_km: 5, duration_min: 5,
        start_otp: "1111", end_otp: "2222" }, p_ride_fare_cents: fareCents, p_ride_option: rideOption, p_expected_customer_total_cents: fareCents + serviceFee }), "Auxiliary RPC booking");
    trips.push(result.trip.id);
    const active = required(await db.from("trips").update({ driver_id: nearest.driverId, status: "ongoing", start_otp_verified: true,
      trip_started_at: new Date(Date.now() - 300000).toISOString() }).eq("id", result.trip.id).select("*").single(), "Auxiliary active fixture");
    check(`${label} 15% snapshot`, Number(active.commission_basis_points) === 1500);
    const args = { p_trip_id: active.id, p_actor_id: nearest.id, p_expected_driver_id: nearest.driverId, p_mode: "otp", p_otp: "2222",
      p_reason: null, p_note: null, p_expected_financial_version: Number(active.financial_version), p_expected_fare: fareCents / 100, p_distance_audit: "Disposable validation" };
    return { active, args, fareCents };
  }
  async function finish(fixture) {
    required(await db.rpc("phase05b_complete_trip", fixture.args), "Guarded completion");
    const post = required(await db.rpc("phase2_post_trip_commission", { p_trip_id: fixture.active.id, p_actor_id: nearest.id }), "Commission posting");
    assert.equal(Number(post.commission_cents), Math.floor((fixture.fareCents * 1500 + 5000) / 10000));
  }
  for (let i = 0; i < 3; i++) await finish(await completedCommission(i === 0 ? "group" : "go", `Debt fixture ${i}`));
  const below = required(await db.rpc("phase2_finance_eligibility", { p_driver_id: nearest.driverId }), "R45 eligibility");
  check("R45 debt remains eligible", Number(below.net_owed_cents) === 4500 && below.authoritative_eligible === true, below);
  const activeBeforeDebt = await completedCommission("go", "Pre-existing active trip");
  await finish(await completedCommission("go", "Debt reaches R50", 3333));
  const above = required(await db.rpc("phase2_finance_eligibility", { p_driver_id: nearest.driverId }), "R50 eligibility");
  check("Exact R50 debt restricted from new work", Number(above.net_owed_cents) === 5000 && above.authoritative_eligible === false, above);
  await finish(activeBeforeDebt);
  check("Existing active trip can finish above debt threshold", true);
  check("No infrastructure scheduler failure", !logs.includes("permission denied for table dispatch_jobs"));
} catch (error) {
  check("Harness completed all sections", false, error instanceof Error ? error.message : String(error));
  console.log("SERVER_DIAGNOSTIC_TAIL " + logs.slice(-5000));
} finally {
  // Fixtures and financial audit records remain isolated on disposable; disable only our Drivers.
  for (const item of drivers) required(await db.from("drivers").update({ online: false }).eq("id", item.driverId), "Fixture offline cleanup");
  if (server && server.exitCode === null) {
    const stopped = new Promise(resolve => server.once("exit", resolve));
    server.kill();
    await stopped;
  }
  console.log(JSON.stringify({ run, disposable: "tangtlmdpnvmoviwrgvd", trips, checks,
    passed: checks.filter(item => item.pass).length, failed: checks.filter(item => !item.pass).length }, null, 2));
  if (checks.some(item => !item.pass)) process.exitCode = 1;
}
