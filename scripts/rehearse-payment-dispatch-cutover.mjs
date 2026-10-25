// Disposable local Supabase only. Runs the actual committed route/coordinator/
// dispatch modules from the live and corrected trees with controlled candidate
// selection and notification transport. No provider or production endpoints.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createClient } = require("@supabase/supabase-js");
const container = "supabase_db_moovu-release4-local-cert-20261021";
const authContainer = "supabase_auth_moovu-release4-local-cert-20261021";
const liveRoot = path.resolve("../moovu-sustained-performance");
const candidateRoot = path.resolve(".");
const compatRoot = path.resolve("../moovu-release4-dispatch-compat");
const expectedLive = "606c8106c074866c3380348d520e5c2aaf5b0aa0";
const expectedCandidate = "2681278d5e92383630f5ad41ac369560b3497b27";
const expectedCompatibility = "9beb27c99fcaa722151e9d17e7fb9640efa37675";
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: liveRoot, encoding: "utf8" }).trim(), expectedLive);
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: compatRoot, encoding: "utf8" }).trim(), expectedCompatibility);
execFileSync("git", ["merge-base", "--is-ancestor", expectedCandidate, "HEAD"], { cwd: candidateRoot });
const protectedDiff = execFileSync("git", ["diff", "--name-only", expectedCandidate, "HEAD", "--", "src", "supabase/migrations"], { cwd: candidateRoot, encoding: "utf8" }).trim();
assert(protectedDiff === "" || protectedDiff === "supabase/migrations/20261022182716_online_payment_dispatch_cutover_control.sql", "Rehearsal must run only the reviewed cutover migration beyond the reviewed implementation");
const auth = JSON.parse(execFileSync("docker", ["inspect", authContainer], { encoding: "utf8" }))[0];
const jwtSecret = auth.Config.Env.find(value => value.startsWith("GOTRUE_JWT_SECRET=")).slice("GOTRUE_JWT_SECRET=".length);
const base64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const header = base64({ alg: "HS256", typ: "JWT" });
const payload = base64({ role: "service_role", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
const token = `${header}.${payload}.${createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url")}`;
const local = createClient("http://127.0.0.1:57321", token, { auth: { persistSession: false } });
process.env.MOOVU_DISPATCH_90S_ENABLED = "false";
process.env.MOOVU_ONLINE_PAYOUTS_ENABLED = "false";
process.env.MOOVU_UNIVERSAL_FARE_23_ENABLED = "false";
process.env.CRON_SECRET = `local-${randomUUID()}`;
process.env.YOCO_ENVIRONMENT = "test";
const webhookKey = randomBytes(32);
process.env.YOCO_WEBHOOK_SECRET = `whsec_${webhookKey.toString("base64")}`;

function sql(statement) {
  return execFileSync("docker", ["exec", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-Atc", statement], { encoding: "utf8" }).trim();
}
const [customerId, driverA, driverB] = sql("select (select customer_id from public.trips where customer_id is not null limit 1)::text || '|' || (select string_agg(id::text,'|' order by id) from (select id from public.drivers order by id limit 2) d)").split("|");
assert(customerId && driverA && driverB, "Disposable fixture needs one Customer and two Drivers");
sql("update public.driver_trip_offers o set status='expired',updated_at=now() from public.online_payment_attempts a where a.trip_id=o.trip_id and a.idempotency_key like 'cutover:%' and o.status in ('shown','pending','offered')");
sql("insert into public.phase6_policy(singleton,active) values(true,false) on conflict(singleton) do update set active=false; update public.drivers set online=true,last_seen=now(),lat=-26,lng=28,status='approved',verification_status='approved',profile_completed=true,seating_capacity=4 where id in ('" + driverA + "','" + driverB + "')");
const deliveries = [];
const processorEvidence = [];
const claimCalls = new Map();
let oldCandidateGate = null;
let notificationGate = null;
let oldNotificationGate = null;
let crashNextJob = false;
let candidateDrivers = { old: [driverA, driverB], corrected: [driverA, driverB] };
const client = {
  from: (...args) => {
    if (args[0] === "dispatch_jobs" && crashNextJob) {
      crashNextJob = false;
      return { upsert: async () => { throw new Error("SYNTHETIC_WORKER_CRASH_AFTER_RESERVATION"); } };
    }
    return local.from(...args);
  },
  rpc: async (name, args) => {
    if (name === "claim_online_payment_dispatch") {
      claimCalls.set(args.p_attempt_id, (claimCalls.get(args.p_attempt_id) ?? 0) + 1);
    }
    if (name === "phase3_process_trusted_payment_event") {
      // The trusted processor was certified separately. This local seam makes
      // its durable result visible to the real signed-webhook route.
      const { data: attempt, error: lookupError } = await local.from("online_payment_attempts")
        .select("id,state").eq("provider_checkout_id", args.p_checkout_id).maybeSingle();
      if (lookupError || !attempt) return { data: null, error: lookupError ?? { code: "LOCAL_NOT_FOUND" } };
      if (attempt.state === "SUCCEEDED") return { data: { result: "REPLAYED" }, error: null };
      const { error } = await local.from("online_payment_attempts").update({ state: "SUCCEEDED", dispatch_state: "PENDING", verified_at: new Date().toISOString() }).eq("id", attempt.id);
      if (!error) processorEvidence.push({ attemptId: attempt.id, eventId: args.p_event_id });
      return { data: { result: "SUCCEEDED" }, error };
    }
    return local.rpc(name, args);
  },
};

function loadTree(root) {
  const cache = new Map();
  const variant = root === liveRoot ? "old" : "corrected";
  function load(specifier, parent) {
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/supabase/admin") return { supabaseAdmin: client };
    if (specifier === "@/lib/dispatch/dispatchCandidates") return {
      getDispatchCandidates: async () => {
        if (variant === "old" && oldCandidateGate) {
          const gate = oldCandidateGate;
          oldCandidateGate = null;
          gate.entered();
          await gate.releasePromise;
        }
        return candidateDrivers[variant].map((driverId, index) => ({
        driverId, distanceKm: index + 1, roadEtaSeconds: 60, score: 80 - index,
        scoreBreakdown: { distance: 70, rotation: 5, reliability: 5, quality: 0, missedPenalty: 0, total: 80 - index },
        }));
      },
      getPreferredDispatchCandidate: async () => ({ ok: false, error: "Not used by this rehearsal" }),
    };
    if (specifier === "@/lib/dispatch/notifyDriverOffer") return { notifyDriverOffer: async ({ tripId, driverId }) => {
      deliveries.push({ root: path.basename(root), tripId, driverId });
      if (root === candidateRoot && notificationGate) {
        const gate = notificationGate;
        notificationGate = null;
        gate.entered();
        await gate.releasePromise;
      }
      if (root === liveRoot && oldNotificationGate) {
        const gate = oldNotificationGate;
        oldNotificationGate = null;
        gate.entered();
        await gate.releasePromise;
      }
    } };
    if (specifier === "@/lib/push-notify") return { notifyAdmins: async () => {} };
    if (specifier === "@/lib/dispatch/dispatchTrip90s") return { dispatchTrip90s: () => { throw Error("90-second dispatch must remain off"); } };
    if (specifier === "@/lib/dispatch/matchingWindowPolicy") return { isNinetySecondDispatchEnabledFor: () => false };
    if (specifier === "@/lib/dispatch/cancelExpiredDispatch") return { cancelExpiredDispatch: async () => {} };
    if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return require(specifier);
    let filename = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2)) : path.resolve(path.dirname(parent), specifier);
    if (!path.extname(filename)) filename += ".ts";
    if (cache.has(filename)) return cache.get(filename);
    const source = readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const exports = {};
    cache.set(filename, exports);
    const localRequire = child => load(child, filename);
    new Function("require", "exports", "module", "process", "console", "Buffer", "crypto", output)(
      localRequire, exports, { exports }, process,
      { log() {}, info() {}, warn() {}, error() {} }, Buffer, globalThis.crypto,
    );
    return exports;
  }
  return {
    cron: load("@/app/api/jobs/online-payment-dispatch/route", path.join(root, "src", "index.ts")),
    webhook: load("@/app/api/payments/yoco/webhook/route", path.join(root, "src", "index.ts")),
    coordinator: load("@/lib/payments/yoco/dispatch", path.join(root, "src", "index.ts")),
  };
}
const old = loadTree(liveRoot);
const corrected = loadTree(candidateRoot);
const compatibility = loadTree(compatRoot);

function mode() {
  return sql("select mode from public.online_payment_dispatch_control where singleton=true");
}
function setMode(expected, next) {
  sql(`select public.set_online_payment_dispatch_mode('${expected}','${next}')`);
  assert.equal(mode(), next);
}
function resetLocalMode() {
  const current = mode();
  if (current === "RUNNING") setMode("RUNNING", "DRAINING");
  if (mode() === "DRAINING") setMode("DRAINING", "PAUSED");
  if (mode() === "PAUSED") setMode("PAUSED", "LEGACY");
  assert.equal(mode(), "LEGACY");
}
resetLocalMode();

function seed(label, state = "SUCCEEDED") {
  const tripId = randomUUID(), attemptId = randomUUID(), checkoutId = `local_${label}_${randomUUID()}`;
  sql(`insert into public.trips(id,pickup_address,dropoff_address,payment_method,status,customer_id,ride_type,ride_option,pickup_lat,pickup_lng,fare_amount,created_at) values('${tripId}','Synthetic pickup','Synthetic destination','online','requested','${customerId}','now','go',-26,28,100,now()); insert into public.online_payment_attempts(id,customer_id,trip_id,provider,provider_checkout_id,amount_cents,currency,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at,dispatch_state,dispatch_attempts) values('${attemptId}','${customerId}','${tripId}','YOCO','${checkoutId}',10000,'ZAR',repeat('a',64),'{}'::jsonb,'${state}','cutover:${attemptId}',repeat('b',64),${state === "SUCCEEDED" ? "now()" : "null"},'PENDING',0)`);
  return { tripId, attemptId, checkoutId };
}
function retire(fixture) {
  sql(`update public.driver_trip_offers set status='expired',updated_at=now() where trip_id='${fixture.tripId}' and status in ('shown','pending','offered'); update public.drivers set busy=false where id in ('${driverA}','${driverB}')`);
}
function holdOldAtCandidateSelection() {
  let entered, release;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const releasePromise = new Promise(resolve => { release = resolve; });
  oldCandidateGate = { entered, releasePromise };
  return { enteredPromise, release };
}
function holdCorrectedAtNotification() {
  let entered, release;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const releasePromise = new Promise(resolve => { release = resolve; });
  notificationGate = { entered, releasePromise };
  return { enteredPromise, release };
}
function holdOldAtNotification() {
  let entered, release;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const releasePromise = new Promise(resolve => { release = resolve; });
  oldNotificationGate = { entered, releasePromise };
  return { enteredPromise, release };
}
async function counts(fixture) {
  const [{ data: offerRows, error: offerError }, { data: attempt, error: attemptError }, { count: jobs }] = await Promise.all([
    local.from("driver_trip_offers").select("id,payment_dispatch_round_id,status").eq("trip_id", fixture.tripId),
    local.from("online_payment_attempts").select("state,dispatch_state,dispatch_attempts,dispatch_claim_token").eq("id", fixture.attemptId).single(),
    local.from("dispatch_jobs").select("id", { count: "exact", head: true }).eq("trip_id", fixture.tripId),
  ]);
  assert(!offerError && !attemptError);
  const active = (offerRows ?? []).filter(row => ["shown", "pending", "offered"].includes(row.status));
  return { offers: offerRows.length, activeRounds: new Set(active.map(row => row.payment_dispatch_round_id ?? "legacy")).size,
    claims: claimCalls.get(fixture.attemptId) ?? 0, jobs, state: attempt.state, dispatchState: attempt.dispatch_state,
    attempts: attempt.dispatch_attempts, ownerCleared: attempt.dispatch_claim_token === null };
}
function signedRequest(fixture, eventId) {
  const body = JSON.stringify({ id: eventId, type: "payment.succeeded", payload: { id: `p_${eventId}`, amount: 10000, currency: "ZAR", status: "succeeded", mode: "test", metadata: { checkoutId: fixture.checkoutId } } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", webhookKey).update(`${eventId}.${timestamp}.${body}`).digest("base64");
  return new Request("http://localhost/api/payments/yoco/webhook", { method: "POST", headers: { "webhook-id": eventId, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` }, body });
}
const report = {};
const cronRequest = () => new Request("http://localhost/api/jobs/online-payment-dispatch", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
const before = seed("old");
const oldResult = await old.coordinator.dispatchVerifiedOnlineTrip(before.attemptId);
report.oldWorker = { result: oldResult.reason, ...(await counts(before)), deliveries: deliveries.filter(d => d.tripId === before.tripId).length };
const duplicate = await old.coordinator.dispatchVerifiedOnlineTrip(before.attemptId).catch(e => ({ error: e.message }));
report.oldDuplicate = { result: duplicate.reason ?? duplicate.error, ...(await counts(before)), deliveries: deliveries.filter(d => d.tripId === before.tripId).length };
// End only the synthetic old offers so the next isolated scenario starts with
// eligible Drivers. No production or shared remote records are involved.
retire(before);
const oldWebhookFixture = seed("old-webhook", "PENDING");
const oldWebhookResponse = await old.webhook.POST(signedRequest(oldWebhookFixture, `evt_${randomUUID()}`));
report.oldSignedWebhook = { http: oldWebhookResponse.status, ...(await counts(oldWebhookFixture)), deliveries: deliveries.filter(d => d.tripId === oldWebhookFixture.tripId).length };
retire(oldWebhookFixture);
const fresh = seed("new");
const [first, second] = await Promise.allSettled([
  corrected.coordinator.dispatchVerifiedOnlineTrip(fresh.attemptId),
  corrected.coordinator.dispatchVerifiedOnlineTrip(fresh.attemptId),
]);
report.correctedOverlap = { outcomes: [first, second].map(x => x.status === "fulfilled" ? x.value.reason : "ERROR"), ...(await counts(fresh)), deliveries: deliveries.filter(d => d.tripId === fresh.tripId).length };
retire(fresh);
const webhookFixture = seed("webhook", "PENDING");
const webhookResponse = await corrected.webhook.POST(signedRequest(webhookFixture, `evt_${randomUUID()}`));
report.signedWebhook = { http: webhookResponse.status, body: await webhookResponse.json(), ...(await counts(webhookFixture)), durableProcessorEvidence: processorEvidence.some(e => e.attemptId === webhookFixture.attemptId) };
const retryResponse = await corrected.webhook.POST(signedRequest(webhookFixture, `evt_${randomUUID()}`));
report.duplicateWebhook = { http: retryResponse.status, ...(await counts(webhookFixture)) };
retire(webhookFixture);

const interruptedWebhook = seed("interrupted-webhook", "PENDING");
crashNextJob = true;
const interruptedResponse = await corrected.webhook.POST(signedRequest(interruptedWebhook, `evt_${randomUUID()}`));
const interruptedState = await counts(interruptedWebhook);
sql(`update public.online_payment_attempts set dispatch_claim_until=now()-interval '1 second' where id='${interruptedWebhook.attemptId}'`);
const interruptedRecovery = await corrected.coordinator.dispatchVerifiedOnlineTrip(interruptedWebhook.attemptId);
report.interruptedWebhook = { http: interruptedResponse.status, body: await interruptedResponse.json(), afterWebhook: interruptedState, recovery: interruptedRecovery.reason, ...(await counts(interruptedWebhook)) };
retire(interruptedWebhook);

// An old worker may have already read the attempt before cron is stopped.
// If it is released after the corrected owner acknowledges, the ownership
// trigger no longer fences that old invocation.
candidateDrivers = { old: [driverB], corrected: [driverA] };
const overlapFixture = seed("overlap");
const gate = holdOldAtCandidateSelection();
const inFlightOld = old.coordinator.dispatchVerifiedOnlineTrip(overlapFixture.attemptId);
await gate.enteredPromise;
const newDuringOverlap = await corrected.coordinator.dispatchVerifiedOnlineTrip(overlapFixture.attemptId);
gate.release();
const oldAfterNew = await inFlightOld.catch(e => ({ reason: `ERROR:${e.message}` }));
report.oldNewOverlap = { newResult: newDuringOverlap.reason, oldResult: oldAfterNew.reason, ...(await counts(overlapFixture)), deliveries: deliveries.filter(d => d.tripId === overlapFixture.tripId).map(d => d.driverId === driverA ? "A" : "B") };
retire(overlapFixture);

candidateDrivers = { old: [driverB], corrected: [driverA] };
const crashFixture = seed("crash");
crashNextJob = true;
const crashed = await corrected.coordinator.dispatchVerifiedOnlineTrip(crashFixture.attemptId).catch(e => e.message);
const afterCrash = await counts(crashFixture);
const staleToken = sql(`select dispatch_claim_token::text from public.online_payment_attempts where id='${crashFixture.attemptId}'`);
sql(`update public.online_payment_attempts set dispatch_claim_until=now()-interval '1 second' where id='${crashFixture.attemptId}'`);
const recovered = await corrected.coordinator.dispatchVerifiedOnlineTrip(crashFixture.attemptId);
const staleAck = await local.rpc("finish_online_payment_dispatch", { p_attempt_id: crashFixture.attemptId, p_claim_token: staleToken, p_success: false, p_error: "stale" });
report.crashRecovery = { crashed, afterCrash, recovery: recovered.reason, ...(await counts(crashFixture)), staleAck: staleAck.data, deliveries: deliveries.filter(d => d.tripId === crashFixture.tripId).length };
retire(crashFixture);

// The original live source remains a bad rollback even after a successful
// corrected run: it can restart an offered trip with a different Driver.
const rollbackFixture = seed("rollback");
await corrected.coordinator.dispatchVerifiedOnlineTrip(rollbackFixture.attemptId);
const rollbackOld = await old.coordinator.dispatchVerifiedOnlineTrip(rollbackFixture.attemptId).catch(e => ({ reason: `ERROR:${e.message}` }));
report.oldRollback = { oldResult: rollbackOld.reason, ...(await counts(rollbackFixture)), deliveries: deliveries.filter(d => d.tripId === rollbackFixture.tripId).map(d => d.driverId === driverA ? "A" : "B") };
retire(rollbackFixture);
candidateDrivers = { old: [driverB], corrected: [driverA] };
const cronFixture = seed("cron-recovery");
// The cron route orders by attempt update time. Put this synthetic target first
// so stale fixtures from earlier local runs cannot consume its test Drivers.
sql(`update public.online_payment_attempts set updated_at='2020-01-01T00:00:00Z' where id='${cronFixture.attemptId}'`);
const cronResponse = await corrected.cron.GET(cronRequest());
const cronBody = await cronResponse.json();
report.correctedCron = { http: cronResponse.status, processed: cronBody.processed, target: cronBody.results?.find(row => row.id === cronFixture.attemptId), pendingBooking: await counts(cronFixture) };
retire(cronFixture);
assert.equal(report.oldSignedWebhook.http, 200);
assert.equal(report.oldSignedWebhook.deliveries, 2, "Old signed webhook must be shown to dispatch without cron");
assert.deepEqual(new Set(report.correctedOverlap.outcomes), new Set(["DISPATCHED", "ALREADY_IN_PROGRESS"]));
assert.equal(report.correctedOverlap.offers, 2);
assert.equal(report.duplicateWebhook.offers, report.signedWebhook.offers);
assert.equal(report.interruptedWebhook.afterWebhook.state, "SUCCEEDED");
assert.equal(report.interruptedWebhook.afterWebhook.dispatchState, "PENDING");
assert.equal(report.interruptedWebhook.recovery, "EXISTING_OFFER_ROUND_RECOVERED");
assert.equal(report.correctedCron.target?.reason, "DISPATCHED");
assert.equal(report.correctedCron.pendingBooking.offers, 1);
assert.deepEqual(report.oldNewOverlap.deliveries, ["A", "B"], "Old/new overlap must reproduce competing sends");
assert.equal(report.oldNewOverlap.offers, 2);
assert.equal(report.crashRecovery.recovery, "EXISTING_OFFER_ROUND_RECOVERED");
assert.equal(report.crashRecovery.staleAck, "STALE");
assert.deepEqual(report.oldRollback.deliveries, ["A", "B"], "Old rollback must reproduce competing sends");

// The control migration is installed but begins in LEGACY. Activate its
// operator-only modes in this disposable database after the baseline probe.
candidateDrivers = { old: [driverB], corrected: [driverA] };
const legacyOfferFixture = seed("legacy-offer-recovery");
crashNextJob = true;
const legacyInterrupted = await old.coordinator.dispatchVerifiedOnlineTrip(legacyOfferFixture.attemptId).catch(e => e.message);
report.legacyOfferBeforeFence = { interrupted: legacyInterrupted, ...(await counts(legacyOfferFixture)), deliveries: deliveries.filter(d => d.tripId === legacyOfferFixture.tripId).length };
candidateDrivers.old = [driverA];
const oldNotificationFixture = seed("old-offer-notifying");
const oldNotificationHold = holdOldAtNotification();
const oldNotifying = old.coordinator.dispatchVerifiedOnlineTrip(oldNotificationFixture.attemptId);
await oldNotificationHold.enteredPromise;
report.oldNotificationBeforeFence = { ...(await counts(oldNotificationFixture)), deliveries: deliveries.filter(d => d.tripId === oldNotificationFixture.tripId).length };
candidateDrivers.old = [driverB];
const drainingFixture = seed("draining-inflight");
const drainingGate = holdOldAtCandidateSelection();
const oldAlreadyRunning = old.coordinator.dispatchVerifiedOnlineTrip(drainingFixture.attemptId);
await drainingGate.enteredPromise;
setMode("LEGACY", "DRAINING");
drainingGate.release();
const drainedOld = await oldAlreadyRunning.catch(e => ({ reason: `ERROR:${e.message}` }));
report.drainingOld = { result: drainedOld.reason, ...(await counts(drainingFixture)), deliveries: deliveries.filter(d => d.tripId === drainingFixture.tripId).length };

const twoOldFixture = seed("two-old-draining");
const twoOld = await Promise.allSettled([
  old.coordinator.dispatchVerifiedOnlineTrip(twoOldFixture.attemptId),
  old.coordinator.dispatchVerifiedOnlineTrip(twoOldFixture.attemptId),
]);
report.twoOldDraining = { results: twoOld.map(r => r.status === "fulfilled" ? r.value.reason : "REJECTED"), ...(await counts(twoOldFixture)), deliveries: deliveries.filter(d => d.tripId === twoOldFixture.tripId).length };

const pausedWebhookFixture = seed("paused-webhook", "PENDING");
const pausedWebhookResponse = await old.webhook.POST(signedRequest(pausedWebhookFixture, `evt_${randomUUID()}`));
report.drainingWebhook = { http: pausedWebhookResponse.status, body: await pausedWebhookResponse.json(), ...(await counts(pausedWebhookFixture)), deliveries: deliveries.filter(d => d.tripId === pausedWebhookFixture.tripId).length };
setMode("DRAINING", "PAUSED");
const pausedCorrected = await compatibility.coordinator.dispatchVerifiedOnlineTrip(pausedWebhookFixture.attemptId).catch(e => e.message);
report.pausedClaim = { result: pausedCorrected, ...(await counts(pausedWebhookFixture)) };
setMode("PAUSED", "RUNNING");
const twoOldRunningFixture = seed("two-old-running");
const twoOldRunning = await Promise.allSettled([
  old.coordinator.dispatchVerifiedOnlineTrip(twoOldRunningFixture.attemptId),
  old.coordinator.dispatchVerifiedOnlineTrip(twoOldRunningFixture.attemptId),
]);
report.twoOldRunning = { results: twoOldRunning.map(r => r.status === "fulfilled" ? r.value.reason : "REJECTED"), ...(await counts(twoOldRunningFixture)), deliveries: deliveries.filter(d => d.tripId === twoOldRunningFixture.tripId).length };
const legacyRecovered = await compatibility.coordinator.dispatchVerifiedOnlineTrip(legacyOfferFixture.attemptId);
report.legacyOfferRecovery = { result: legacyRecovered.reason, ...(await counts(legacyOfferFixture)), deliveries: deliveries.filter(d => d.tripId === legacyOfferFixture.tripId).length };
retire(legacyOfferFixture);
const oldNotificationRecovered = await compatibility.coordinator.dispatchVerifiedOnlineTrip(oldNotificationFixture.attemptId);
oldNotificationHold.release();
const oldNotificationCompletion = await oldNotifying.catch(e => ({ reason: `ERROR:${e.message}` }));
report.oldNotificationAfterFence = { recovery: oldNotificationRecovered.reason, oldResult: oldNotificationCompletion.reason, ...(await counts(oldNotificationFixture)), deliveries: deliveries.filter(d => d.tripId === oldNotificationFixture.tripId).length };
const staleAckProbe = await local.from("online_payment_attempts")
  .update({ dispatch_state: "DISPATCHED", dispatched_at: new Date().toISOString() })
  .eq("id", oldNotificationFixture.attemptId);
report.oldStaleAckRejectedByDatabase = { code: staleAckProbe.error?.code ?? null, ...(await counts(oldNotificationFixture)) };
retire(oldNotificationFixture);
const resumed = await compatibility.coordinator.dispatchVerifiedOnlineTrip(pausedWebhookFixture.attemptId);
report.resumedPayment = { result: resumed.reason, ...(await counts(pausedWebhookFixture)), deliveries: deliveries.filter(d => d.tripId === pausedWebhookFixture.tripId).length };
const oldAfterRunning = await old.coordinator.dispatchVerifiedOnlineTrip(pausedWebhookFixture.attemptId).catch(e => ({ reason: `ERROR:${e.message}` }));
report.oldAfterRunning = { result: oldAfterRunning.reason, ...(await counts(pausedWebhookFixture)), deliveries: deliveries.filter(d => d.tripId === pausedWebhookFixture.tripId).length };
retire(pausedWebhookFixture);

// The old webhook can still verify payment under RUNNING but cannot reserve.
// Its request overlaps an actual corrected cron invocation for the same trip.
const crossRouteFixture = seed("old-webhook-new-cron", "PENDING");
const crossRouteGate = holdOldAtCandidateSelection();
const oldWebhookInFlight = old.webhook.POST(signedRequest(crossRouteFixture, `evt_${randomUUID()}`));
await crossRouteGate.enteredPromise;
sql(`update public.online_payment_attempts set updated_at='2020-01-01T00:00:00Z' where id='${crossRouteFixture.attemptId}'`);
const correctedCronResponse = await compatibility.cron.GET(cronRequest());
const correctedCronBody = await correctedCronResponse.json();
crossRouteGate.release();
const oldWebhookFinished = await oldWebhookInFlight;
report.crossRoute = {
  oldHttp: oldWebhookFinished.status,
  oldBody: await oldWebhookFinished.json(),
  newCronHttp: correctedCronResponse.status,
  target: correctedCronBody.results?.find(row => row.id === crossRouteFixture.attemptId),
  ...(await counts(crossRouteFixture)),
  deliveries: deliveries.filter(d => d.tripId === crossRouteFixture.tripId).length,
};
retire(crossRouteFixture);

// The compatibility source is the only safe application rollback target.
const safeRollbackFixture = seed("compat-rollback");
const rollbackGate = holdCorrectedAtNotification();
const integratedInFlight = corrected.coordinator.dispatchVerifiedOnlineTrip(safeRollbackFixture.attemptId);
await rollbackGate.enteredPromise;
const compatibilityDuringClaim = await compatibility.coordinator.dispatchVerifiedOnlineTrip(safeRollbackFixture.attemptId);
rollbackGate.release();
const integratedFinished = await integratedInFlight;
const compatibilityAfterClaim = await compatibility.coordinator.dispatchVerifiedOnlineTrip(safeRollbackFixture.attemptId);
report.compatibilityRollback = {
  during: compatibilityDuringClaim.reason,
  integrated: integratedFinished.reason,
  after: compatibilityAfterClaim.reason,
  ...(await counts(safeRollbackFixture)),
  deliveries: deliveries.filter(d => d.tripId === safeRollbackFixture.tripId).length,
};
retire(safeRollbackFixture);

const claimCrashFixture = seed("claim-crash");
const abandonedToken = randomUUID();
const { data: abandonedClaim, error: claimError } = await local.rpc("claim_online_payment_dispatch", { p_attempt_id: claimCrashFixture.attemptId, p_token: abandonedToken, p_lease_seconds: 120 });
claimCalls.set(claimCrashFixture.attemptId, (claimCalls.get(claimCrashFixture.attemptId) ?? 0) + 1);
assert(!claimError && abandonedClaim?.[0]?.outcome === "START");
const afterAbandonedClaim = await counts(claimCrashFixture);
sql(`update public.online_payment_attempts set dispatch_claim_until=now()-interval '1 second' where id='${claimCrashFixture.attemptId}'`);
const claimRecovered = await compatibility.coordinator.dispatchVerifiedOnlineTrip(claimCrashFixture.attemptId);
report.claimCrashRecovery = { afterCrash: afterAbandonedClaim, recovery: claimRecovered.reason, ...(await counts(claimCrashFixture)), deliveries: deliveries.filter(d => d.tripId === claimCrashFixture.tripId).length };
retire(claimCrashFixture);

const runningCrashFixture = seed("running-reservation-crash");
crashNextJob = true;
const runningCrash = await compatibility.coordinator.dispatchVerifiedOnlineTrip(runningCrashFixture.attemptId).catch(e => e.message);
const runningAfterCrash = await counts(runningCrashFixture);
sql(`update public.online_payment_attempts set dispatch_claim_until=now()-interval '1 second' where id='${runningCrashFixture.attemptId}'`);
const runningRecovered = await compatibility.coordinator.dispatchVerifiedOnlineTrip(runningCrashFixture.attemptId);
report.runningCrashRecovery = { crash: runningCrash, afterCrash: runningAfterCrash, recovery: runningRecovered.reason, ...(await counts(runningCrashFixture)), deliveries: deliveries.filter(d => d.tripId === runningCrashFixture.tripId).length };
retire(runningCrashFixture);

const runningDuplicateFixture = seed("running-duplicate-webhook", "PENDING");
const runningWebhookFirst = await compatibility.webhook.POST(signedRequest(runningDuplicateFixture, `evt_${randomUUID()}`));
const runningWebhookBeforeReplay = await counts(runningDuplicateFixture);
const runningWebhookReplay = await compatibility.webhook.POST(signedRequest(runningDuplicateFixture, `evt_${randomUUID()}`));
report.runningDuplicateWebhook = { firstHttp: runningWebhookFirst.status, replayHttp: runningWebhookReplay.status, beforeReplay: runningWebhookBeforeReplay, ...(await counts(runningDuplicateFixture)), deliveries: deliveries.filter(d => d.tripId === runningDuplicateFixture.tripId).length };

assert.equal(report.drainingOld.offers, 0);
assert.equal(report.drainingOld.dispatchState, "PENDING");
assert.equal(report.drainingOld.attempts, 0);
assert.equal(report.twoOldDraining.offers, 0);
assert.equal(report.twoOldRunning.offers, 0);
assert.equal(report.twoOldRunning.deliveries, 0);
assert.equal(report.twoOldRunning.dispatchState, "PENDING");
assert.equal(report.drainingWebhook.http, 200);
assert.equal(report.drainingWebhook.body.dispatchPending, true);
assert.equal(report.drainingWebhook.state, "SUCCEEDED");
assert.equal(report.drainingWebhook.dispatchState, "PENDING");
assert.equal(report.drainingWebhook.attempts, 0);
assert.equal(report.pausedClaim.attempts, 0);
assert.equal(report.resumedPayment.result, "DISPATCHED");
assert.equal(report.oldAfterRunning.offers, report.resumedPayment.offers);
assert.equal(report.oldAfterRunning.deliveries, report.resumedPayment.deliveries);
assert.equal(report.crossRoute.target?.reason, "DISPATCHED");
assert.equal(report.crossRoute.oldBody.dispatchPending, true);
assert.equal(report.crossRoute.offers, 1);
assert.equal(report.crossRoute.deliveries, 1);
assert.equal(report.compatibilityRollback.during, "ALREADY_IN_PROGRESS");
assert.equal(report.compatibilityRollback.after, "ALREADY_DISPATCHED");
assert.equal(report.compatibilityRollback.offers, 1);
assert.equal(report.compatibilityRollback.deliveries, 1);
assert.equal(report.legacyOfferBeforeFence.offers, 1);
assert.equal(report.legacyOfferBeforeFence.dispatchState, "PENDING");
assert.equal(report.legacyOfferRecovery.result, "EXISTING_OFFER_ROUND_RECOVERED");
assert.equal(report.legacyOfferRecovery.offers, 1);
assert.equal(report.oldNotificationBeforeFence.offers, 1);
assert.equal(report.oldNotificationAfterFence.recovery, "EXISTING_OFFER_ROUND_RECOVERED");
assert.equal(report.oldNotificationAfterFence.offers, 1);
assert.equal(report.oldNotificationAfterFence.deliveries, 1);
assert.equal(report.oldNotificationAfterFence.dispatchState, "DISPATCHED");
assert.equal(report.oldStaleAckRejectedByDatabase.code, "P0D03");
assert.equal(report.claimCrashRecovery.afterCrash.offers, 0);
assert.equal(report.claimCrashRecovery.recovery, "DISPATCHED");
assert.equal(report.claimCrashRecovery.offers, 1);
assert.equal(report.runningCrashRecovery.afterCrash.offers, 1);
assert.equal(report.runningCrashRecovery.recovery, "EXISTING_OFFER_ROUND_RECOVERED");
assert.equal(report.runningCrashRecovery.offers, 1);
assert.equal(report.runningCrashRecovery.deliveries, 0);
assert.equal(report.runningDuplicateWebhook.beforeReplay.offers, report.runningDuplicateWebhook.offers);
assert.equal(report.runningDuplicateWebhook.deliveries, report.runningDuplicateWebhook.offers);
console.log(JSON.stringify(report));
