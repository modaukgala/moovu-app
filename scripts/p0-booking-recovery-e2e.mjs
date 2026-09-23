import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.PHASE3_E2E_SUPABASE_URL;
const anon = process.env.PHASE3_E2E_SUPABASE_ANON_KEY;
const service = process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && anon && service, "Disposable credentials required");
assert.equal(new URL(url).hostname, "tangtlmdpnvmoviwrgvd.supabase.co");
const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const password = randomUUID() + "Aa!";
const base = "http://127.0.0.1:3587";
const checks = [], drivers = [], trips = [];
const extendedOnly = process.argv.includes("--extended-only");
let server, logs = "", customer, admin;
const pickup = { lat: -25.48, lng: 28.68 };
const dropoff = { lat: -25.485, lng: 28.70 };

function required(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
function check(name, pass, details = null) {
  checks.push({ name, pass: Boolean(pass), details });
  console.log(JSON.stringify(checks.at(-1)));
}
async function request(path, token, body) {
  const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function login(email) {
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = required(await client.auth.signInWithPassword({ email, password }), "Authenticated password login");
  return { id: signed.user.id, token: signed.session.access_token, client };
}
async function authUser(role, metadata = {}) {
  const email = `p0-${role}-${randomUUID()}@example.com`;
  const created = required(await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata }), "Auth fixture").user;
  if (role !== "customer") required(await db.from("profiles").insert({ id: created.id, role }), "Non-customer profile fixture");
  return { ...(await login(email)), email };
}
async function signup() {
  const email = `p0-signup-${randomUUID()}@example.com`;
  const phone = `+278${String(Date.now()).slice(-8)}`;
  const result = await request("/api/customer/register", null, { first_name: "P0", last_name: run, email, phone,
    password, acceptedTerms: true, acceptedPrivacy: true, termsVersion: "2026-06-23", privacyVersion: "2026-06-23" });
  check("Real customer signup API succeeds", result.status === 200, { status: result.status, error: result.body?.error });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const account = await login(email);
  const row = required(await db.from("customers").select("*").eq("auth_user_id", account.id).single(), "Signup Customer");
  const profile = required(await db.from("profiles").select("*").eq("id", account.id).single(), "Signup actor profile");
  check("Signup creates least-privileged canonical profile without fixture profile insertion", profile.role === "customer" &&
    profile.id === row.auth_user_id && profile.full_name === `P0 ${run}`);
  return { ...account, customerId: row.id };
}
async function driver(options = {}) {
  const account = await authUser("driver");
  const id = randomUUID();
  required(await db.from("drivers").insert({ id, first_name: "P0", last_name: run,
    phone: `+276${String(Date.now()).slice(-7)}${drivers.length % 10}`,
    status: options.status ?? "approved", verification_status: "approved", profile_completed: true,
    online: options.online ?? true, busy: false, is_deleted: false, seating_capacity: options.seats ?? 7,
    lat: options.lat ?? pickup.lat, lng: pickup.lng, last_seen: new Date().toISOString(),
    subscription_status: "inactive", subscription_expires_at: null }), "Subscription-free driver");
  required(await db.from("driver_accounts").insert({ user_id: account.id, driver_id: id }), "Driver link");
  required(await db.from("driver_wallets").insert({ driver_id: id, balance_due: 0 }), "Legacy wallet");
  const row = { ...account, driverId: id };
  drivers.push(row);
  return row;
}
async function debtFixture(owner, amount) {
  if (!amount) return;
  const ensure = async (code, category, type, id, side) => {
    let lookup = db.from("financial_accounts").select("*").eq("account_category", category)
      .eq("owner_type", type).eq("currency", "ZAR");
    lookup = id ? lookup.eq("owner_id", id) : lookup.is("owner_id", null);
    const existing = required(await lookup.maybeSingle(), "Existing fixture financial account");
    return existing ?? required(await db.rpc("phase1_ensure_financial_account", {
      p_account_code: code, p_account_category: category, p_owner_type: type, p_owner_id: id,
      p_normal_balance_side: side, p_currency: "ZAR" }), "Debt fixture account");
  };
  const debt = await ensure(`DRIVER:${owner.driverId.toUpperCase()}:COMMISSION_DEBT:ZAR`, "DRIVER_COMMISSION_DEBT", "DRIVER", owner.driverId, "DEBIT");
  const clearing = await ensure(`P0:${run}:ADJUSTMENT:CLEARING`, "ADJUSTMENT_CLEARING", "PLATFORM", null, "CREDIT");
  const id = randomUUID();
  required(await db.rpc("phase1_post_financial_transaction", { p_idempotency_key: `p0-debt:${id}`,
    p_payload_hash: createHash("sha256").update(id).digest("hex"), p_transaction_type: "ADJUSTMENT", p_source_type: "ADJUSTMENT",
    p_source_id: id, p_currency: "ZAR", p_actor_type: "ADMIN", p_actor_id: admin.id, p_effective_at: new Date().toISOString(),
    p_entries: [{ account_id: debt.id, entry_side: "DEBIT", amount_cents: amount },
      { account_id: clearing.id, entry_side: "CREDIT", amount_cents: amount }],
    p_metadata: { disposable_only: true, run, purpose: "P0 eligibility boundary" } }), "Balanced debt fixture posting");
}
async function offers(id) {
  return required(await db.from("driver_trip_offers").select("*").eq("trip_id", id).order("created_at"), "Offer history");
}
async function commissionRows(id) {
  return required(await db.from("financial_transactions").select("*").eq("idempotency_key", `trip_commission:${id}`), "Commission transactions");
}
async function noCommission(id, label) {
  check(label, (await commissionRows(id)).length === 0 &&
    required(await db.from("driver_wallet_transactions").select("id").eq("trip_id", id).eq("tx_type", "commission"), "Legacy premature commission").length === 0);
}
let route;
async function booking(option = "go", extra = {}, at = pickup) {
  const destination = at === pickup ? dropoff : { lat: at.lat - .005, lng: at.lng + .02 };
  const routed = (await request("/api/maps/distance", customer.token, {
    origin_lat: at.lat, origin_lng: at.lng, destination_lat: destination.lat, destination_lng: destination.lng, waypoints: [] })).body;
  const quote = await request("/api/customer/phase5-quote", customer.token, { pickup: at, dropoff: destination,
    stops: [], routeQuote: routed.routeQuote, rideOption: option });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  const payload = { pickupAddress: `P0 ${run} ${option}`, dropoffAddress: "Disposable destination", pickupLat: at.lat, pickupLng: at.lng,
    dropoffLat: destination.lat, dropoffLng: destination.lng, stops: [], paymentMethod: "cash",
    distanceKm: routed.distanceKm, durationMin: routed.durationMin, originalDistanceKm: routed.originalDistanceKm,
    originalDurationMin: routed.originalDurationMin, routeQuote: routed.routeQuote, rideType: "now", rideOption: option,
    phase5ExpectedTotalCents: quote.body.quote.customerTotalCents, bookingKey: randomUUID(), ...extra };
  const result = await request("/api/customer/book-trip", customer.token, payload);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  trips.push(result.body.tripId);
  return { id: result.body.tripId, result, payload, quote: quote.body.quote, at, destination };
}
async function heartbeat(owner, at) {
  const result = await request("/api/driver/heartbeat", owner.token, { ...at, accuracyM: 5, speedMps: 0, capturedAt: new Date().toISOString() });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result;
}
async function startJourney(option, owner) {
  const booked = await booking(option, { customer_id: randomUUID(), created_by: admin.id, fareAmount: 1 });
  check(`${option} authenticated booking creates server-owned actor and fare`, booked.result.body.trip.created_by === customer.id &&
    booked.result.body.trip.customer_id === customer.customerId && Number(booked.result.body.trip.phase5_customer_total_cents) === booked.quote.customerTotalCents);
  check(`${option} dispatch offers a subscription-free eligible driver`, (await offers(booked.id)).some(row => row.driver_id === owner.driverId));
  const received = await request("/api/driver/offers/current", owner.token);
  check(`${option} driver receives real authenticated in-app offer`, received.status === 200 && received.body?.offer?.id === booked.id);
  await noCommission(booked.id, `${option} booking and offer generate no commission`);
  const accepted = await request("/api/driver/offers/respond", owner.token, { tripId: booked.id, action: "accept" });
  check(`${option} authenticated driver acceptance`, accepted.status === 200, accepted.body);
  assert.equal(accepted.status, 200);
  await noCommission(booked.id, `${option} acceptance generates no commission`);
  await heartbeat(owner, pickup);
  check(`${option} subscription-free authenticated GPS heartbeat`, true);
  const arrived = await request("/api/driver/trips/arrive", owner.token, { tripId: booked.id });
  check(`${option} authenticated arrival`, arrived.status === 200, arrived.body);
  assert.equal(arrived.status, 200);
  const state = await request(`/api/customer/trip-status?tripId=${booked.id}`, customer.token);
  check(`${option} customer sees assigned driver after acceptance`, state.status === 200 && Boolean(state.body?.driver));
  const wrongOTP = await request("/api/driver/trips/start", owner.token, { tripId: booked.id, otp: "invalid" });
  check(`${option} wrong start OTP blocked`, wrongOTP.status === 400);
  const started = await request("/api/driver/trips/start", owner.token, { tripId: booked.id, otp: booked.result.body.otp.startOtp });
  check(`${option} authenticated start OTP`, started.status === 200, started.body);
  assert.equal(started.status, 200);
  await noCommission(booked.id, `${option} start generates no commission`);
  const early = await request("/api/driver/trips/complete", owner.token, { tripId: booked.id, otp: booked.result.body.otp.endOtp });
  check(`${option} minimum trip duration guard remains active`, early.status === 400 && /Minimum required time/.test(early.body?.error));
  return { ...booked, owner, startedAt: Date.now() };
}
async function finishJourney(fixture) {
  const trip = required(await db.from("trips").select("*").eq("id", fixture.id).single(), "Trip completion state");
  const minimum = Math.max(120, Math.min(600, Math.round(Number(trip.duration_min) * 60 * .2)));
  const wait = fixture.startedAt + minimum * 1000 + 1500 - Date.now();
  if (wait > 0) { console.log(`Waiting ${Math.ceil(wait / 1000)}s for real minimum-duration guard; no clock or lifecycle mutation.`); await delay(wait); }
  await heartbeat(fixture.owner, dropoff);
  const wrongOTP = await request("/api/driver/trips/complete", fixture.owner.token, { tripId: fixture.id, otp: "invalid" });
  check(`${trip.ride_option} wrong end OTP blocked`, wrongOTP.status === 400);
  const result = await request("/api/driver/trips/complete", fixture.owner.token, { tripId: fixture.id, otp: fixture.result.body.otp.endOtp });
  check(`${trip.ride_option} authenticated end OTP and completion`, result.status === 200, result.body);
  assert.equal(result.status, 200);
  const rows = await commissionRows(fixture.id);
  const expected = Math.floor((Number(trip.phase5_driver_fare_basis_cents) * 1500 + 5000) / 10000);
  const entries = rows.length === 1 ? required(await db.from("financial_ledger_entries").select("entry_side,amount_cents").eq("transaction_id", rows[0].id), "Commission ledger entries") : [];
  check(`${trip.ride_option} exactly one balanced 15% commission`, rows.length === 1 && rows[0].transaction_state === "POSTED" &&
    entries.filter(row => row.entry_side === "DEBIT").reduce((sum, row) => sum + Number(row.amount_cents), 0) === expected &&
    entries.filter(row => row.entry_side === "CREDIT").reduce((sum, row) => sum + Number(row.amount_cents), 0) === expected);
  check(`${trip.ride_option} no duplicate legacy driver debt`, required(await db.from("driver_wallet_transactions").select("id")
    .eq("trip_id", fixture.id).eq("tx_type", "commission"), "Legacy duplicate debt").length === 0);
  const again = await request("/api/driver/trips/complete", fixture.owner.token, { tripId: fixture.id, otp: fixture.result.body.otp.endOtp });
  check(`${trip.ride_option} completion replay creates no duplicate obligation`, again.status === 409 && (await commissionRows(fixture.id)).length === 1);
}

async function extendedChecks() {
  for (const owner of drivers) required(await db.from("drivers").update({ online: false }).eq("id", owner.driverId), "Race isolation");
  const a = await booking(), b = await booking();
  const owner = await driver();
  const reserve = (tripId, person, cycle = 1, sequence = 1) => db.rpc("reserve_trip_offer", {
    p_trip_id: tripId, p_driver_id: person.driverId, p_dispatch_cycle: cycle, p_sequence_number: sequence,
    p_distance_km: 0, p_road_eta_seconds: 60, p_dispatch_score: 1, p_score_breakdown: {},
    p_escalation_seconds: 25, p_accept_window_seconds: 25 });
  const simultaneous = await Promise.all([reserve(a.id, owner), reserve(b.id, owner)]);
  check("Concurrent reservations for one driver permit exactly one trip", simultaneous.filter(row => !row.error).length === 1);
  assert.equal(simultaneous.filter(row => !row.error).length, 1);
  const winningTrip = simultaneous[0].error ? b.id : a.id;
  const otherTrip = winningTrip === a.id ? b.id : a.id;
  const otherDriver = await driver();
  required(await reserve(otherTrip, otherDriver), "Unrelated expiry reservation");
  for (const id of [winningTrip, otherTrip]) required(await db.from("driver_trip_offers")
    .update({ accept_deadline_at: new Date(Date.now() - 1000).toISOString() }).eq("trip_id", id), "Race deadline fixture");
  required(await db.rpc("expire_due_trip_offers", { p_trip_id: winningTrip }), "Scoped expiry RPC");
  check("Trip-scoped expiry leaves unrelated due offers untouched", (await offers(winningTrip)).every(row => row.status === "expired") &&
    (await offers(otherTrip)).every(row => row.status === "shown"));
  check("Expired offer cannot reserve again in the same cycle", Boolean((await reserve(winningTrip, owner)).error));
  required(await reserve(winningTrip, owner, 2), "Explicit later round retry");
  check("Expired candidate can retry only in explicit later cycle", (await offers(winningTrip)).length === 2);
  for (const id of [winningTrip, otherTrip]) {
    required(await db.from("driver_trip_offers").update({ accept_deadline_at: new Date(Date.now() - 1000).toISOString() })
      .eq("trip_id", id).in("status", ["shown", "pending"]), "Acceptance setup deadline");
    required(await db.rpc("expire_due_trip_offers", { p_trip_id: id }), "Acceptance setup expiry");
  }
  for (const person of [owner, otherDriver]) required(await db.from("drivers").update({ online: false }).eq("id", person.driverId), "Book before race");
  const race = await booking();
  for (const person of [owner, otherDriver]) {
    required(await db.from("drivers").update({ online: true }).eq("id", person.driverId), "Race online");
    required(await reserve(race.id, person), "Acceptance race reservations");
  }
  const accepted = await Promise.all([owner, otherDriver].map(person =>
    request("/api/driver/offers/respond", person.token, { tripId: race.id, action: "accept" })));
  check("Concurrent authenticated acceptance has one winner", accepted.filter(row => row.status === 200).length === 1 &&
    accepted.filter(row => row.status === 409).length === 1, accepted.map(row => ({ status: row.status, code: row.body?.code })));
  check("Acceptance race cancels losing offer without commission", (await offers(race.id)).filter(row => row.status === "accepted").length === 1 &&
    (await offers(race.id)).filter(row => row.status === "cancelled").length === 1 && (await commissionRows(race.id)).length === 0);
  const repeated = await Promise.all(Array.from({ length: 3 }, () => request("/api/customer/book-trip", customer.token, race.payload)));
  check("Concurrent booking replay preserves trip identity and OTP", repeated.every(row => row.status === 200 && row.body.tripId === race.id &&
    row.body.otp.startOtp === race.result.body.otp.startOtp && row.body.otp.endOtp === race.result.body.otp.endOtp));
  for (const client of [customer.client, createClient(url, anon, { auth: { persistSession: false } })]) {
    check("Untrusted client cannot reserve offers", Boolean((await client.rpc("reserve_trip_offer", {
      p_trip_id: a.id, p_driver_id: owner.driverId, p_dispatch_cycle: 3, p_sequence_number: 1,
      p_distance_km: 0, p_road_eta_seconds: 1, p_dispatch_score: 1, p_score_breakdown: {} })).error));
    check("Untrusted client cannot accept or expire offers", Boolean((await client.rpc("accept_trip_offer", {
      p_trip_id: a.id, p_driver_id: owner.driverId })).error) && Boolean((await client.rpc("expire_due_trip_offers", { p_trip_id: a.id })).error));
  }
  const original = required(await db.from("profiles").select("*").eq("id", customer.id).single(), "Identity race baseline");
  const customerRow = required(await db.from("customers").select("*").eq("id", customer.customerId).single(), "Identity race customer");
  const upserts = await Promise.all(Array.from({ length: 4 }, () => db.from("customers").upsert(customerRow, { onConflict: "auth_user_id" })));
  const after = required(await db.from("profiles").select("*").eq("id", customer.id).single(), "Identity race postflight");
  check("Concurrent customer persistence preserves one unchanged canonical actor", upserts.every(row => !row.error) && JSON.stringify(original) === JSON.stringify(after));
  for (const person of [owner, otherDriver]) required(await db.from("drivers").update({ online: false }).eq("id", person.driverId), "Wrong class isolation");
  const goOnly = await driver({ seats: 5 });
  const xl = await booking("group");
  check("Go-only vehicle cannot receive XL through live dispatch or direct reservation", (await offers(xl.id)).length === 0 &&
    Boolean((await reserve(xl.id, goOnly)).error));
  required(await db.from("drivers").update({ online: false }).eq("id", goOnly.driverId), "Extended cleanup");
  const sixSeat = await driver({ seats: 6 });
  const sixSeatXL = await booking("group");
  check("Six-seat review vehicle remains Go-only and cannot bypass XL reservation", (await offers(sixSeatXL.id)).length === 0 &&
    Boolean((await reserve(sixSeatXL.id, sixSeat)).error));
  required(await db.from("drivers").update({ online: false }).eq("id", sixSeat.driverId), "Six-seat fixture offline");
}

try {
  const policy = required(await db.rpc("phase2_current_policy"), "Current finance policy");
  assert.ok(policy.mode === "AUTHORITATIVE" && Number(policy.go_basis_points) === 1500 && Number(policy.go_xl_basis_points) === 1500 &&
    Number(policy.debt_limit_cents) === 5000 && policy.subscription_required === false);
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service,
    MOOVU_PHASE2_FINANCE_MODE: "AUTHORITATIVE" };
  for (const name of Object.keys(env)) if (/FIREBASE|FCM|VAPID|GOOGLE_APPLICATION_CREDENTIALS|RESEND|SMTP|QSTASH/.test(name)) env[name] = "";
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", "3587"], { env, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { logs += chunk.toString(); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Isolated server startup failed: ${logs.slice(-2000)}`);
    try { if ((await fetch(base)).status < 500) { ready = true; break; } } catch { /* startup */ }
    await delay(1000);
  }
  assert.ok(ready, "Disposable-only server startup");
  check("Unauthenticated booking blocked", (await request("/api/customer/book-trip", null, {})).status === 401);
  await request("/api/driver/offers/respond", null, {});
  await request("/api/driver/trips/arrive", null, {});
  await request("/api/driver/trips/start", null, {});
  await request("/api/driver/trips/complete", null, {});
  await request("/api/driver/offers/current", null);
  await request("/api/driver/heartbeat", null, {});
  admin = await authUser("admin");
  customer = await signup();
  route = (await request("/api/maps/distance", customer.token, { origin_lat: pickup.lat, origin_lng: pickup.lng,
    destination_lat: dropoff.lat, destination_lng: dropoff.lng, waypoints: [] })).body;
  assert.ok(route?.routeQuote, "Real Maps signed route quote");
  const other = await authUser("customer", { first_name: "Fallback", last_name: run, phone: `+277${String(Date.now()).slice(-8)}` });
  const before = required(await db.from("profiles").select("id").eq("id", other.id), "Missing fallback actor");
  assert.equal(before.length, 0);
  const fallback = await request("/api/customer/phase5-quote", other.token, { pickup, dropoff, stops: [], routeQuote: route.routeQuote, rideOption: "go" });
  check("Existing Auth fallback account creation establishes actor profile", fallback.status === 200 &&
    required(await db.from("profiles").select("role").eq("id", other.id).single(), "Fallback profile").role === "customer");
  check("Customer RLS hides another profile", required(await customer.client.from("profiles").select("id").eq("id", admin.id), "Profile RLS").length === 0);
  check("Customer cannot promote own profile", Boolean((await customer.client.from("profiles").update({ role: "admin" }).eq("id", customer.id).select()).error) ||
    required(await db.from("profiles").select("role").eq("id", customer.id).single(), "Promotion postflight").role === "customer");
  check("Customer cannot execute trusted booking RPC", Boolean((await customer.client.rpc("phase5_create_trip", {
    p_customer_id: customer.customerId, p_actor_id: customer.id, p_booking_key: randomUUID(), p_trip_payload: {},
    p_ride_fare_cents: 10000, p_ride_option: "go", p_expected_customer_total_cents: 10300 })).error));
  if (!extendedOnly) {
  const first = await driver();
  const go = await startJourney("go", first);
  const idor = await request(`/api/customer/trip-status?tripId=${go.id}`, other.token);
  check("Customer trip ownership cannot be impersonated", [403, 404].includes(idor.status));
  const replay = await request("/api/customer/book-trip", customer.token, go.payload);
  check("Booking replay preserves one trip and one offer", replay.status === 200 && replay.body?.tripId === go.id && (await offers(go.id)).length === 1);
  check("Booking replay returns persisted OTPs", replay.body?.otp?.startOtp === go.result.body.otp.startOtp &&
    replay.body?.otp?.endOtp === go.result.body.otp.endOtp);
  const second = await driver({ lat: pickup.lat + .0001 });
  const xl = await startJourney("group", second);

  const matrixAt = { lat: -25.80, lng: pickup.lng };
  for (const item of [
    { label: "R0", debt: 0, expected: true }, { label: "R49.99", debt: 4999, expected: true },
    { label: "R50", debt: 5000, expected: false }, { label: "R100", debt: 10000, expected: false },
    { label: "Inactive", status: "inactive", debt: 0, expected: false },
    { label: "Rejected", status: "rejected", debt: 0, expected: false },
    { label: "Offline", online: false, debt: 0, expected: false },
    { label: "Wrong class", seats: 2, debt: 0, expected: false },
  ]) {
    const owner = await driver({ ...item, lat: matrixAt.lat });
    await debtFixture(owner, item.debt);
    const position = required(await db.rpc("phase2_finance_eligibility", { p_driver_id: owner.driverId }), "Matrix financial authority");
    check(`${item.label} exact authoritative debt`, Number(position.net_owed_cents) === item.debt && position.subscription_required === false);
    const booked = await booking("go", {}, matrixAt);
    const sent = (await offers(booked.id)).some(row => row.driver_id === owner.driverId);
    check(`${item.label} connected subscription-free dispatch eligibility`, sent === item.expected);
    if (item.expected) {
      const received = await request("/api/driver/offers/current", owner.token);
      check(`${item.label} authenticated driver offer receipt`, received.body?.offer?.id === booked.id);
      const accept = await request("/api/driver/offers/respond", owner.token, { tripId: booked.id, action: "accept" });
      check(`${item.label} authenticated acceptance`, accept.status === 200);
    } else {
      const reservation = await db.rpc("reserve_trip_offer", { p_trip_id: booked.id, p_driver_id: owner.driverId,
        p_dispatch_cycle: 1, p_sequence_number: 1, p_distance_km: 0, p_road_eta_seconds: 60, p_dispatch_score: 1, p_score_breakdown: {} });
      check(`${item.label} database reservation cannot bypass eligibility`, Boolean(reservation.error));
    }
    required(await db.from("drivers").update({ online: false }).eq("id", owner.driverId), "Matrix fixture offline");
  }
  // Cross the threshold only AFTER the real active trip started; existing work can finish.
  await debtFixture(second, 5000);
  await heartbeat(second, pickup);
  check("R50 does not block active-trip GPS telemetry", true);
  await finishJourney(go);
  await finishJourney(xl);
  check("Existing active XL finishes after R50 threshold crossing", required(await db.from("trips").select("status").eq("id", xl.id).single(), "Above-debt completion").status === "completed");

  // Isolated offer/retry/cap fixtures: real HTTP booking, then controlled disposable
  // offer deadline manipulation only. Never mutate a trip's lifecycle to fake E2E.
  for (const owner of [first, second]) required(await db.from("drivers").update({ online: false }).eq("id", owner.driverId), "Journey isolation");
  const retryAt = { lat: -26.10, lng: pickup.lng };
  const pool = [];
  for (let i = 0; i < 26; i++) pool.push(await driver({ lat: retryAt.lat + i * .00001 }));
  const retry = await booking("go", {}, retryAt);
  let history = await offers(retry.id);
  check("Connected candidate cap remains 25", history.length === 25);
  const originalIds = new Set(history.map(row => row.driver_id));
  required(await db.from("driver_trip_offers").update({ accept_deadline_at: new Date(Date.now() - 1000).toISOString() }).eq("trip_id", retry.id)
    .in("status", ["pending", "shown"]), "Scoped expired deadline fixture");
  const next = await request("/api/admin/trips/auto-assign", admin.token, { tripId: retry.id });
  history = await offers(retry.id);
  check("Expiry advances to untried candidate rather than repeating previous batch", next.status === 200 &&
    history.filter(row => row.status === "shown").length === 1 && !originalIds.has(history.find(row => row.status === "shown")?.driver_id));
  const current = history.find(row => row.status === "shown");
  const owner = pool.find(row => row.driverId === current?.driver_id);
  assert.ok(owner);
  const rejected = await request("/api/driver/offers/respond", owner.token, { tripId: retry.id, action: "reject" });
  check("Authenticated decline persisted and never retried", rejected.status === 200 &&
    (await offers(retry.id)).filter(row => row.driver_id === owner.driverId).every(row => row.status === "declined"));
  const board = await request("/api/admin/dispatch/board", admin.token);
  check("Admin attempted count derives from canonical history", board.status === 200 && board.body?.rows?.find(row => row.id === retry.id)?.attempted_count === 26);
  for (const row of pool) required(await db.from("drivers").update({ online: false }).eq("id", row.driverId), "Pool offline");
  }

  await extendedChecks();

  const noDriver = await booking();
  check("No eligible driver creates safe searchable trip without commission", noDriver.result.body.autoOfferStarted === false && (await offers(noDriver.id)).length === 0);
  const failing = await request("/api/customer/book-trip", customer.token, { ...noDriver.payload, bookingKey: randomUUID(), rideType: "scheduled",
    scheduledFor: new Date(Date.now() + 1800000).toISOString() });
  check("Scheduled creation is rejected before an incompatible database write", failing.status === 409 &&
    failing.body?.code === "SCHEDULED_RIDES_DISABLED");
} catch (error) {
  check("All connected sections reached", false, error instanceof Error ? error.message : String(error));
  console.log("ISOLATED_SERVER_DIAGNOSTIC " + logs.slice(-4500));
} finally {
  for (const owner of drivers) {
    const cleaned = await db.from("drivers").update({ online: false }).eq("id", owner.driverId);
    if (cleaned.error) check("Fixture cleanup", false, cleaned.error.message);
  }
  if (server && server.exitCode === null) { const stopped = new Promise(resolve => server.once("exit", resolve)); server.kill(); await stopped; }
  const evidence = { run, disposable: "tangtlmdpnvmoviwrgvd", production_mutated: false, customer_id: customer?.customerId,
    fixture_driver_ids: drivers.map(row => row.driverId), trip_ids: trips, checks,
    passed: checks.filter(row => row.pass).length, failed: checks.filter(row => !row.pass).length,
    notes: "Authenticated HTTP lifecycle with simulated GPS via the real heartbeat API and real elapsed duration; no real-device push sends." };
  writeFileSync(extendedOnly ? "docs/p0-booking-recovery-extended-evidence.json" : "docs/p0-booking-recovery-connected-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.failed) process.exitCode = 1;
}
