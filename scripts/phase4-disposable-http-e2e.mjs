import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.PHASE3_E2E_SUPABASE_URL;
const anon = process.env.PHASE3_E2E_SUPABASE_ANON_KEY;
const service = process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && anon && service, "Disposable credentials missing");
assert.ok(url.includes("tangtlmdpnvmoviwrgvd") && !url.includes("mvazbszenqahgqpznhhq"), "Unsafe project target");

const admin = createClient(url, service, { auth: { persistSession: false } });
const auth = createClient(url, anon, { auth: { persistSession: false } });
const port = 3481;
const base = `http://127.0.0.1:${port}`;
const runId = randomUUID().slice(0, 8);
const password = `${randomUUID()}Aa!`;
const users = [];
let server;

async function required(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
async function request(path, token, body) {
  const response = await fetch(base + path, { method: "POST", headers: {
    "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function makeUser(role) {
  const email = `phase4-${role}-${runId}@example.com`;
  const created = await required(await admin.auth.admin.createUser({ email, password, email_confirm: true }), "Auth fixture");
  const id = created.user.id;
  users.push(id);
  await required(await admin.from("profiles").upsert({ id, role }), "Profile fixture");
  const signed = await required(await auth.auth.signInWithPassword({ email, password }), "Fixture sign in");
  assert.ok(signed.session?.access_token);
  return { id, token: signed.session.access_token };
}
async function makeTrip(customerId, props = {}) {
  const id = randomUUID();
  await required(await admin.from("trips").insert({ id, customer_id: customerId,
    status: "requested", ride_option: "go", payment_method: "cash", ...props }), "Trip fixture");
  return id;
}

try {
  const customer = await makeUser("customer");
  const driver = await makeUser("driver");
  const owner = await makeUser("admin");
  const customerId = randomUUID();
  const driverId = randomUUID();
  await required(await admin.from("customers").insert({ id: customerId, auth_user_id: customer.id,
    first_name: "Phase", last_name: "Four", phone: "+27110000000", status: "active" }), "Customer fixture");
  await required(await admin.from("drivers").insert({ id: driverId, busy: true }), "Driver fixture");
  await required(await admin.from("driver_accounts").insert({ user_id: driver.id, driver_id: driverId }), "Driver mapping");

  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service,
    PHASE05_OUTBOX_ENABLED: "true" };
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(port)],
    { env, stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error("Disposable app server exited");
    try { const response = await fetch(base); if (response.status < 500) { ready = true; break; } } catch {}
    await delay(1000);
  }
  assert.ok(ready, "Disposable app server did not become healthy");
  assert.equal((await request("/api/customer/cancellation-quote", null, { tripId: randomUUID() })).status, 401);

  const freeTrip = await makeTrip(customerId);
  let quoted = await request("/api/customer/cancellation-quote", customer.token, { tripId: freeTrip });
  assert.equal(quoted.status, 200, `Authenticated free quote failed: ${quoted.body?.error ?? "unknown"}`);
  assert.equal(quoted.body.authority, "PHASE4");
  assert.equal(Number(quoted.body.quote.terms.fee_cents), 0);
  let cancelled = await request("/api/customer/cancel-trip", customer.token,
    { tripId: freeTrip, quoteId: quoted.body.quote.quote_id, reason: "Changed my mind" });
  assert.equal(cancelled.status, 200, "Authenticated free cancellation failed");

  const staleTrip = await makeTrip(customerId, { status: "offered",
    created_at: new Date(Date.now() - 5 * 60_000).toISOString() });
  const staleQuote = await request("/api/customer/cancellation-quote", customer.token, { tripId: staleTrip });
  assert.equal(staleQuote.status, 200);
  assert.equal(Number(staleQuote.body.quote.terms.fee_cents), 0);
  await required(await admin.from("trips").update({ status: "assigned", driver_id: driverId })
    .eq("id", staleTrip), "Disposable assignment race");
  const staleConfirm = await request("/api/customer/cancel-trip", customer.token,
    { tripId: staleTrip, quoteId: staleQuote.body.quote.quote_id, reason: "Changed my mind" });
  assert.equal(staleConfirm.status, 409, "Stale quote was silently accepted");
  assert.equal(staleConfirm.body.requiresReconfirmation, true);
  const refreshed = await request("/api/customer/cancellation-quote", customer.token, { tripId: staleTrip });
  assert.equal(refreshed.status, 200);
  assert.equal(Number(refreshed.body.quote.terms.fee_cents), 2000);
  assert.equal((await request("/api/customer/cancel-trip", customer.token,
    { tripId: staleTrip, quoteId: refreshed.body.quote.quote_id, reason: "Changed my mind" })).status, 200);
  const staleAssessment = await required(await admin.from("phase4_fee_assessments").select("id")
    .eq("trip_id", staleTrip).single(), "Stale quote assessment");
  assert.equal((await request("/api/admin/phase4-finance", owner.token, {
    assessmentId: staleAssessment.id, action: "REVERSAL", reason: "Disposable quote-race cleanup",
  })).status, 200);

  const chargedTrip = await makeTrip(customerId, { status: "assigned", driver_id: driverId,
    created_at: new Date(Date.now() - 5 * 60_000).toISOString() });
  quoted = await request("/api/customer/cancellation-quote", customer.token, { tripId: chargedTrip });
  assert.equal(quoted.status, 200, "Authenticated charged quote failed");
  assert.equal(Number(quoted.body.quote.terms.fee_cents), 2000);
  cancelled = await request("/api/customer/cancel-trip", customer.token,
    { tripId: chargedTrip, quoteId: quoted.body.quote.quote_id, reason: "Changed my mind" });
  assert.equal(cancelled.status, 200, "Authenticated charged cancellation failed");
  assert.equal(cancelled.body.cancellationFeeAmount, 20);
  const replay = await request("/api/customer/cancel-trip", customer.token,
    { tripId: chargedTrip, quoteId: quoted.body.quote.quote_id, reason: "Changed my mind" });
  assert.equal(replay.status, 200, "Cancellation replay failed");
  assert.equal(replay.body.replayed, true);
  const chargedAssessment = await required(await admin.from("phase4_fee_assessments").select("id")
    .eq("trip_id", chargedTrip).single(), "Charged assessment");
  const [assessmentRows, liabilityRows, compensationRows, businessRows] = await Promise.all([
    required(await admin.from("phase4_fee_assessments").select("id").eq("trip_id", chargedTrip), "Assessment identity"),
    required(await admin.from("phase4_customer_liabilities").select("id").eq("assessment_id", chargedAssessment.id), "Liability identity"),
    required(await admin.from("phase4_driver_compensations").select("id").eq("assessment_id", chargedAssessment.id), "Compensation identity"),
    required(await admin.from("moovu_business_events").select("id").eq("event_key", `phase4:customer-cancel:${chargedTrip}`), "Event identity"),
  ]);
  assert.equal(assessmentRows.length, 1);
  assert.equal(liabilityRows.length, 1);
  assert.equal(compensationRows.length, 1);
  assert.equal(businessRows.length, 1);
  const outboxRows = await required(await admin.from("moovu_notification_outbox").select("id")
    .eq("business_event_id", businessRows[0].id), "Outbox identity");
  assert.equal(outboxRows.length, 1);

  const noShowTrip = await makeTrip(customerId, { status: "arrived", driver_id: driverId,
    created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    driver_arrived_at: new Date(Date.now() - 60_000).toISOString(),
    arrival_evidence_qualified: true, arrival_evidence_version: "phase-05b-v1" });
  const early = await request("/api/driver/trips/no-show", driver.token, { tripId: noShowTrip });
  assert.notEqual(early.status, 200, "Early no-show accepted");
  await required(await admin.from("trips").update({ driver_arrived_at: new Date(Date.now() - 6 * 60_000).toISOString() })
    .eq("id", noShowTrip), "Advance disposable arrival clock");
  const noShow = await request("/api/driver/trips/no-show", driver.token, { tripId: noShowTrip });
  assert.equal(noShow.status, 200, "Qualified no-show failed");
  assert.equal(noShow.body.fee.feeAmount, 30);
  const noShowAssessment = await required(await admin.from("phase4_fee_assessments").select("id")
    .eq("trip_id", noShowTrip).single(), "No-show assessment");

  const financeResponse = await fetch(`${base}/api/admin/phase4-finance?tripId=${chargedTrip}`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(financeResponse.status, 200, "Admin visibility failed");
  const finance = await financeResponse.json();
  assert.equal(finance.assessment.id, chargedAssessment.id);
  assert.equal(finance.liability.open_cents, 2000);
  assert.equal(finance.compensation.status, "EARNED");
  const action = (assessmentId, kind, reason) => request("/api/admin/phase4-finance", owner.token,
    { assessmentId, action: kind, reason });
  assert.equal((await action(chargedAssessment.id, "DISPUTE_OPENED", "Customer disputes fee")).status, 200);
  assert.equal((await action(chargedAssessment.id, "DISPUTE_RESOLVED", "Evidence confirms fee")).status, 200);

  for (let i = 0; i < 2; i++) {
    const trip = await makeTrip(customerId);
    await required(await admin.from("trips").update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", trip), "Disposable completed ride");
  }
  const blocked = await request("/api/customer/book-trip", customer.token, {});
  assert.equal(blocked.status, 409, "Two-ride booking block missing");
  assert.equal(blocked.body.code, "PHASE4_BOOKING_BLOCKED");
  assert.equal((await action(noShowAssessment.id, "REVERSAL", "Incorrect no-show evidence")).status, 200);
  assert.equal((await action(chargedAssessment.id, "WAIVER", "Goodwill waiver")).status, 200);
  const unblocked = await request("/api/customer/book-trip", customer.token, {});
  assert.equal(unblocked.status, 400, "Resolved debt did not restore booking eligibility");

  console.log("PHASE4_DISPOSABLE_HTTP_E2E_PASS", JSON.stringify({
    authenticatedQuote: true, freeCancellation: true, chargedCancellation: true,
    staleQuoteReconfirmation: true,
    earlyNoShowRejected: true, qualifiedNoShow: true, adminVisibility: true,
    dispute: true, waiver: true, reversal: true, graceBlock: true, graceResolution: true,
    replaySingleFinancialEffect: true, outboxSingleIdentity: true,
  }));
} finally {
  server?.kill();
  // Financial fixture records are immutable. IDs are retained in disposable only.
  // Auth accounts remain linked to their disposable financial evidence for audit.
}
