import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const url = process.env.PHASE3_E2E_SUPABASE_URL;
const anonKey = process.env.PHASE3_E2E_SUPABASE_ANON_KEY;
const serviceKey = process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && anonKey && serviceKey, "Disposable credentials missing.");
assert.equal(new URL(url).hostname, "tangtlmdpnvmoviwrgvd.supabase.co", "Disposable project guard failed.");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(url, serviceKey, options);
const anon = createClient(url, anonKey, options);
function ok(result, stage) {
  if (result.error) throw new Error(`${stage} failed (${result.error.code ?? "provider error"}).`);
  return result.data;
}
const marker = randomUUID();
const email = `phase6-${marker}@example.invalid`;
const password = randomUUID() + randomUUID();
const user = ok(await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { phase6_disposable: true } }), "Create disposable identity").user;
assert.ok(user);
// Auth signup alone grants no privileged profile role. ENROLL creates only a pending Driver.
// The primary fixture deliberately has no pre-granted Driver/Staff profile.
const actor = createClient(url, anonKey, options);
ok(await actor.auth.signInWithPassword({ email, password }), "Sign in disposable Driver");
const driverToken = (await actor.auth.getSession()).data.session.access_token;
let reviewerToken;
async function runtimeCommand(args) {
  if (!process.env.PHASE6_E2E_BASE_URL) return db.rpc("phase6_command", args);
  const base = new URL(process.env.PHASE6_E2E_BASE_URL);
  assert.equal(base.hostname, "127.0.0.1", "HTTP target must be local.");
  const admin = args.p_actor !== user.id;
  const response = await fetch(new URL(admin ? "/api/admin/onboarding" : "/api/driver/onboarding", base), {
    method: "POST", headers: { Authorization: `Bearer ${admin ? reviewerToken : driverToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: args.p_action, key: args.p_key, application: args.p_application, revision: args.p_revision, payload: args.p_payload, reason: args.p_payload?.reason, sections: args.p_payload?.sections }),
  });
  const body = await response.json();
  return response.ok ? { data: body.application, error: null } : { data: null, error: { code: String(response.status) } };
}
const enroll = { p_actor: user.id, p_key: randomUUID(), p_action: "ENROLL" };
const app = ok(await runtimeCommand(enroll), "Enroll Driver");
assert.equal(app.status, "DRAFT");
const replay = ok(await runtimeCommand(enroll), "Replay enrollment");
assert.equal(replay.id, app.id);
assert.equal(replay.driver_id, app.driver_id);
for (const client of [anon, actor]) {
  const unauthorized = await client.rpc("phase6_command", enroll);
  assert.ok(unauthorized.error, "Public and Driver roles cannot execute trusted commands.");
  const changed = await client.from("drivers").update({ status: "approved", verification_status: "approved", profile_completed: true }).eq("id", app.driver_id);
  assert.ok(changed.error, "Driver cannot write approval fields.");
  const drafts = await client.from("phase6_applications").select("*");
  assert.ok(drafts.error || drafts.data.length === 0, "Private drafts must not be readable directly.");
}
const save = { p_actor: user.id, p_key: randomUUID(), p_action: "SAVE", p_application: app.id, p_revision: app.revision, p_payload: { personal: { first_name: "Fixture", last_name: "Driver" } } };
const saved = ok(await runtimeCommand(save), "Save draft");
assert.equal(saved.revision, app.revision + 1);
assert.deepEqual(ok(await runtimeCommand(save), "Replay save"), saved);
assert.ok((await runtimeCommand({ ...save, p_payload: { personal: { first_name: "Different" } } })).error, "Changed replay payload must conflict.");
const overlaps = await Promise.all([1, 2].map(number => runtimeCommand({ ...save, p_key: randomUUID(), p_revision: saved.revision, p_payload: { personal: { first_name: `Concurrent ${number}` } } })));
assert.equal(overlaps.filter(result => !result.error).length, 1, "Only one concurrent revision may win.");
const latest = overlaps.find(result => !result.error).data;
assert.ok((await db.rpc("phase6_command", { p_actor: user.id, p_key: randomUUID(), p_action: "APPROVED", p_application: app.id, p_revision: latest.revision, p_payload: { reason: "Unauthorized Driver approval" } })).error);
assert.ok((await db.rpc("phase6_command", { p_actor: user.id, p_key: randomUUID(), p_action: "SUBMIT", p_application: app.id, p_revision: latest.revision })).error, "Incomplete submission must fail.");
assert.equal(ok(await db.rpc("phase6_new_work_eligible", { p_driver: app.driver_id }), "Inactive policy"), true);
const adminEmail = `phase6-review-${marker}@example.invalid`;
const reviewerPassword = randomUUID() + randomUUID();
const reviewer = ok(await db.auth.admin.createUser({ email: adminEmail, password: reviewerPassword, email_confirm: true, user_metadata: { phase6_disposable: true } }), "Create disposable reviewer").user;
ok(await db.from("profiles").upsert({ id: reviewer.id, role: "admin", full_name: "Phase 6 disposable reviewer" }), "Set fixture reviewer");
const reviewerClient = createClient(url, anonKey, options);
ok(await reviewerClient.auth.signInWithPassword({ email: adminEmail, password: reviewerPassword }), "Sign in reviewer");
reviewerToken = (await reviewerClient.auth.getSession()).data.session.access_token;
const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: "white" } }).jpeg().toBuffer();
const evidence = {};
for (const requirement of ["personal", "driving", "vehicle", "scanner", "pdp", "insurance"]) {
  const section = requirement === "pdp" ? "driving" : requirement === "insurance" ? "vehicle" : requirement;
  if (process.env.PHASE6_E2E_BASE_URL) {
    const form = new FormData(); form.set("application", app.id); form.set("section", section); form.set("source", "gallery"); form.set("file", new Blob([jpeg], { type: "image/jpeg" }), "fixture.jpg");
    const uploaded = await fetch(new URL("/api/driver/onboarding/evidence", process.env.PHASE6_E2E_BASE_URL), { method: "POST", headers: { Authorization: `Bearer ${driverToken}` }, body: form });
    assert.equal(uploaded.status, 200, "Actual authenticated capture upload must succeed.");
    evidence[requirement] = (await uploaded.json()).evidence;
    continue;
  }
  const id = randomUUID();
  const path = `${app.driver_id}/${app.id}/${id}.jpg`;
  ok(await db.storage.from("phase6-evidence").upload(path, jpeg, { contentType: "image/jpeg" }), "Store fixture image");
  ok(await db.from("phase6_uploads").insert({ id, application_id: app.id, section, object_path: path, source: "gallery", state: "VALIDATED", mime: "image/jpeg", bytes: jpeg.length, width: 640, height: 480 }), "Bind fixture image");
  evidence[requirement] = id;
}
const prefix = "900101500008";
let identity;
for (let n = 0; n < 10; n++) {
  const text = prefix + n;
  const total = [...text].reduce((sum, value, index) => { let digit = Number(value); if (index % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; } return sum + digit; }, 0);
  if (total % 10 === 0) identity = text;
}
const draft = {
  personal: { first_name: "Fixture", last_name: "Driver", phone: "0710000000", id_number: identity, home_address: "Disposable test address", area_name: "Fixture", emergency_contact_name: "Fixture contact", emergency_contact_phone: "0710000001", evidence: { id_document: evidence.personal } },
  driving: { license_number: "DISPOSABLE", license_code: "B", license_expiry: "2030-01-01", evidence: { drivers_license: evidence.driving, pdp: evidence.pdp } },
  vehicle: { vehicle_make: "Fixture", vehicle_model: "Test", vehicle_color: "White", vehicle_registration: marker.replaceAll("-", "").slice(0, 8).toUpperCase(), vehicle_year: "2020", vehicle_vin: "WDB12345678901234", vehicle_engine_number: "TESTENGINE", seating_capacity: "4", evidence: { vehicle_license_disc: evidence.vehicle, insurance: evidence.insurance } },
  scanner: { provider: "Driver self-capture", condition_notes: "Disposable evidence only", evidence: Object.fromEntries(["front", "rear", "driver_side", "passenger_side", "front_interior", "rear_interior", "odometer", "vin", "engine"].map(item => [item, evidence.scanner])) },
};
let current = ok(await runtimeCommand({ ...save, p_key: randomUUID(), p_revision: latest.revision, p_payload: draft }), "Complete fixture draft");
async function command(action, payload = {}, actorId = user.id) {
  current = ok(await runtimeCommand({ p_actor: actorId, p_key: randomUUID(), p_action: action, p_application: current.id, p_revision: current.revision, p_payload: payload }), action);
  return current;
}
await command("SUBMIT");
assert.equal(current.version, 1);
assert.equal(current.status, "SUBMITTED");
const version1 = ok(await db.from("phase6_versions").select("snapshot").eq("application_id", app.id).eq("version", 1).single(), "Read frozen version");
assert.ok((await db.from("phase6_versions").update({ snapshot: {} }).eq("application_id", app.id)).error, "Submitted snapshot cannot be overwritten.");
assert.ok((await db.from("phase6_uploads").update({ state: "SUPERSEDED" }).eq("id", evidence.personal)).error, "Frozen reference cannot be replaced.");
assert.ok((await db.storage.from("phase6-evidence").upload(`${app.driver_id}/${app.id}/${evidence.personal}.jpg`, jpeg, { contentType: "image/jpeg", upsert: true })).error, "Stored submitted bytes cannot be overwritten.");
assert.ok((await db.rpc("phase6_command", { ...save, p_key: randomUUID(), p_revision: current.revision })).error, "Submitted draft is frozen.");
await command("UNDER_REVIEW", { reason: "Reviewing disposable version" }, reviewer.id);
const decisions = await Promise.all([1, 2].map(number => runtimeCommand({ p_actor: reviewer.id, p_key: randomUUID(), p_action: "CORRECTION_REQUESTED", p_application: app.id, p_revision: current.revision, p_payload: { reason: `Disposable correction ${number}`, sections: ["vehicle"] } })));
assert.equal(decisions.filter(result => !result.error).length, 1, "Only one concurrent reviewer decision succeeds.");
current = decisions.find(result => !result.error).data;
assert.ok((await db.rpc("phase6_command", { ...save, p_key: randomUUID(), p_revision: current.revision, p_payload: { personal: draft.personal } })).error, "Unrequested section remains frozen.");
await command("SAVE", { vehicle: { ...draft.vehicle, vehicle_color: "Blue" } });
await command("SUBMIT");
assert.equal(current.version, 2);
assert.equal(current.status, "RESUBMITTED");
assert.deepEqual(ok(await db.from("phase6_versions").select("snapshot").eq("application_id", app.id).eq("version", 1).single(), "Verify previous version"), version1);
await command("UNDER_REVIEW", { reason: "Reviewing corrected evidence" }, reviewer.id);
await command("APPROVED", { reason: "Approved disposable fixture only" }, reviewer.id);
assert.equal(current.status, "APPROVED");
assert.equal(ok(await db.from("drivers").select("id,verification_status,profile_completed").eq("id", app.driver_id).single(), "Verify approved identity").id, app.driver_id);
if (process.env.PHASE6_E2E_BASE_URL) {
  const base = process.env.PHASE6_E2E_BASE_URL;
  const unauthenticated = await fetch(new URL("/api/driver/onboarding", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ENROLL", key: randomUUID() }) });
  assert.equal(unauthenticated.status, 401);
  const own = await fetch(new URL("/api/driver/onboarding", base), { headers: { Authorization: `Bearer ${driverToken}` } });
  assert.equal(own.status, 200); assert.equal((await own.json()).application.driver_id, app.driver_id);
  const otherEmail = `phase6-other-${marker}@example.invalid`, otherPassword = randomUUID() + randomUUID();
  const otherUser = ok(await db.auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true, user_metadata: { phase6_disposable: true } }), "Create other fixture").user;
  ok(await db.from("profiles").upsert({ id: otherUser.id, role: "driver", full_name: "Phase 6 other fixture" }), "Set other fixture role");
  const otherClient = createClient(url, anonKey, options); ok(await otherClient.auth.signInWithPassword({ email: otherEmail, password: otherPassword }), "Sign in other fixture");
  const otherToken = (await otherClient.auth.getSession()).data.session.access_token;
  const otherEnroll = await fetch(new URL("/api/driver/onboarding", base), { method: "POST", headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "ENROLL", key: randomUUID() }) });
  assert.equal(otherEnroll.status, 200); const otherApp = (await otherEnroll.json()).application;
  const corrupt = new FormData(); corrupt.set("application", otherApp.id); corrupt.set("section", "personal"); corrupt.set("source", "gallery"); corrupt.set("file", new Blob(["disguised non-image"], { type: "image/jpeg" }), "fake.jpg");
  assert.equal((await fetch(new URL("/api/driver/onboarding/evidence", base), { method: "POST", headers: { Authorization: `Bearer ${otherToken}` }, body: corrupt })).status, 400, "MIME-disguised content must be rejected.");
  const privileged = await fetch(new URL("/api/driver/onboarding", base), { method: "POST", headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "SAVE", key: randomUUID(), application: otherApp.id, revision: otherApp.revision, payload: { personal: { verification_status: "approved" } } }) }); assert.equal(privileged.status, 400);
  const foreignReference = await fetch(new URL("/api/driver/onboarding", base), { method: "POST", headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "SAVE", key: randomUUID(), application: otherApp.id, revision: otherApp.revision, payload: { personal: { evidence: { id_document: evidence.personal } } } }) }); assert.equal(foreignReference.status, 403);
  const customerEmail = `phase6-customer-${marker}@example.invalid`, customerPassword = randomUUID() + randomUUID();
  const customerUser = ok(await db.auth.admin.createUser({ email: customerEmail, password: customerPassword, email_confirm: true, user_metadata: { phase6_disposable: true } }), "Create Customer fixture").user;
  const customerPhone = `071${Date.now().toString().slice(-7)}`;
  ok(await db.from("customers").insert({ auth_user_id: customerUser.id, first_name: "Phase6", last_name: "Fixture", email: customerEmail, phone: customerPhone, normalized_phone: `+27${customerPhone.slice(1)}` }), "Bind Customer fixture");
  const customerClient = createClient(url, anonKey, options); ok(await customerClient.auth.signInWithPassword({ email: customerEmail, password: customerPassword }), "Sign in Customer fixture");
  const customerToken = (await customerClient.auth.getSession()).data.session.access_token;
  const customerEnroll = await fetch(new URL("/api/driver/onboarding", base), { method: "POST", headers: { Authorization: `Bearer ${customerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "ENROLL", key: randomUUID() }) }); assert.ok(customerEnroll.status >= 400, "Customer cannot claim Driver enrollment.");
  for (const id of Object.values(evidence)) {
    const path = new URL(`/api/driver/onboarding/evidence?application=${app.id}&evidence=${id}`, base);
    for (const token of [null, otherToken, customerToken]) {
      const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      assert.ok(response.status >= 400, "Cross-Driver/anonymous capture access must fail.");
    }
    const response = await fetch(path, { headers: { Authorization: `Bearer ${driverToken}` } }); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    const adminPath = new URL(path); adminPath.searchParams.set("review", "true");
    const adminView = await fetch(adminPath, { headers: { Authorization: `Bearer ${reviewerToken}` } }); assert.equal(adminView.status, 200);
    const fakeAdmin = await fetch(adminPath, { headers: { Authorization: `Bearer ${otherToken}` } }); assert.equal(fakeAdmin.status, 403);
  }
  const crossSave = await fetch(new URL("/api/driver/onboarding", base), { method: "POST", headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "SAVE", key: randomUUID(), application: app.id, revision: current.revision, payload: {} }) });
  assert.equal(crossSave.status, 403);
  const selfApprove = await fetch(new URL("/api/admin/onboarding", base), { method: "POST", headers: { Authorization: `Bearer ${driverToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "APPROVED", key: randomUUID(), application: app.id, revision: current.revision, reason: "Unauthorized self approval" }) });
  assert.equal(selfApprove.status, 401);
  const legacy = await fetch(new URL("/api/driver/apply", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); assert.equal(legacy.status, 410);
  assert.equal((await fetch(new URL("/api/admin/drivers/remove", base), { method: "POST", body: "{}" })).status, 410, "Legacy deletion must not partially unlink identities.");
  const financeBefore = ok(await db.from("financial_accounts").select("*").eq("owner_type", "DRIVER").eq("owner_id", app.driver_id).order("id"), "Finance baseline");
  const mappingBefore = ok(await db.from("driver_accounts").select("driver_id,user_id").eq("user_id", user.id).single(), "Identity baseline");
  const reinspectionKey = randomUUID();
  const reinspectBody = { action: "REINSPECTION_AUTHORIZED", key: reinspectionKey, application: current.id, revision: current.revision, reason: "Disposable event-triggered vehicle inspection" };
  async function httpCommand(token, body, admin = false) {
    const response = await fetch(new URL(admin ? "/api/admin/onboarding" : "/api/driver/onboarding", base), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); return { response, application: data.application, error: data.error };
  }
  const inspection = await httpCommand(reviewerToken, reinspectBody, true); assert.equal(inspection.response.status, 200);
  assert.equal((await httpCommand(reviewerToken, reinspectBody, true)).application.id, inspection.application.id, "Reinspection replay returns the same cycle.");
  assert.equal(ok(await db.from("phase6_enrollments").select("inspection_required").eq("driver_id", app.driver_id).single(), "Inspection hold").inspection_required, true);
  assert.ok((await httpCommand(driverToken, { action: "ENROLL", key: randomUUID() })).application.id === inspection.application.id, "Resume existing identity and cycle.");
  async function completeCycle(application, token, registration) {
    const refs = {};
    for (const section of ["personal", "driving", "vehicle", "scanner"]) {
      const form = new FormData(); form.set("application", application.id); form.set("section", section); form.set("source", "unknown"); form.set("file", new Blob([jpeg], { type: "image/jpeg" }), "fixture.jpg");
      const response = await fetch(new URL("/api/driver/onboarding/evidence", base), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }); assert.equal(response.status, 200); refs[section] = (await response.json()).evidence;
    }
    const payload = structuredClone(draft); payload.personal.evidence = { id_document: refs.personal }; payload.driving.evidence = { drivers_license: refs.driving }; payload.vehicle.evidence = { vehicle_license_disc: refs.vehicle }; payload.vehicle.vehicle_registration = registration;
    payload.scanner.evidence = Object.fromEntries(Object.keys(draft.scanner.evidence).map(key => [key, refs.scanner]));
    const saved = await httpCommand(token, { action: "SAVE", key: randomUUID(), application: application.id, revision: application.revision, payload }); assert.equal(saved.response.status, 200);
    const key = randomUUID(); const body = { action: "SUBMIT", key, application: application.id, revision: saved.application.revision };
    const submitted = await httpCommand(token, body); assert.equal(submitted.response.status, 200);
    assert.deepEqual((await httpCommand(token, body)).application, submitted.application, "Submit retry is exactly once.");
    return submitted.application;
  }
  let cycle = await completeCycle(inspection.application, driverToken, draft.vehicle.vehicle_registration);
  const reviewing = await httpCommand(reviewerToken, { action: "UNDER_REVIEW", key: randomUUID(), application: cycle.id, revision: cycle.revision, reason: "Disposable reinspection review" }, true); assert.equal(reviewing.response.status, 200); cycle = reviewing.application;
  const rejectBody = { action: "REJECTED", key: randomUUID(), application: cycle.id, revision: cycle.revision, reason: "Disposable rejection workflow fixture" };
  const rejected = await httpCommand(reviewerToken, rejectBody, true); assert.equal(rejected.response.status, 200); cycle = rejected.application;
  for (let retry = 0; retry < 2; retry++) assert.deepEqual((await httpCommand(reviewerToken, rejectBody, true)).application, cycle, "Review replay / third retry is stable.");
  assert.ok((await httpCommand(driverToken, { action: "ENROLL", key: randomUUID() })).response.status >= 400, "Rejected Driver cannot self-authorize reapplication.");
  const reapplied = await httpCommand(reviewerToken, { action: "REAPPLICATION_AUTHORIZED", key: randomUUID(), application: cycle.id, revision: cycle.revision, reason: "Authorized disposable reapplication" }, true); assert.equal(reapplied.response.status, 200);
  assert.equal(reapplied.application.driver_id, app.driver_id); assert.ok(reapplied.application.cycle > cycle.cycle);
  assert.equal(ok(await db.from("phase6_applications").select("status").eq("id", cycle.id).single(), "Rejected history").status, "REJECTED");
  let competitor = await completeCycle(otherApp, otherToken, draft.vehicle.vehicle_registration);
  competitor = (await httpCommand(reviewerToken, { action: "UNDER_REVIEW", key: randomUUID(), application: competitor.id, revision: competitor.revision, reason: "Disposable registration conflict review" }, true)).application;
  const conflict = await httpCommand(reviewerToken, { action: "APPROVED", key: randomUUID(), application: competitor.id, revision: competitor.revision, reason: "Disposable conflicting registration test" }, true);
  assert.equal(conflict.response.status, 409); assert.ok(!String(conflict.error).includes(app.driver_id), "Conflict response must not disclose another Driver identity.");
  assert.equal(ok(await db.from("phase6_applications").select("status").eq("id", competitor.id).single(), "Approval failure rollback").status, "UNDER_REVIEW");
  assert.deepEqual(ok(await db.from("driver_accounts").select("driver_id,user_id").eq("user_id", user.id).single(), "Identity preserved"), mappingBefore);
  assert.deepEqual(ok(await db.from("financial_accounts").select("*").eq("owner_type", "DRIVER").eq("owner_id", app.driver_id).order("id"), "Finance preserved"), financeBefore);
  const large = new FormData(); large.set("application", reapplied.application.id); large.set("section", "personal"); large.set("source", "gallery"); large.set("file", new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: "image/jpeg" }), "oversize.jpg");
  assert.equal((await fetch(new URL("/api/driver/onboarding/evidence", base), { method: "POST", headers: { Authorization: `Bearer ${driverToken}` }, body: large })).status, 413);
}
console.log(process.env.PHASE6_E2E_BASE_URL ? "PHASE 6 DISPOSABLE AUTHENTICATED HTTP / CAPTURE / LIFECYCLE / SECURITY VALIDATION PASSED" : "PHASE 6 DISPOSABLE VERSION / SECURITY / REVIEW VALIDATION PASSED — AUTHENTICATED HTTP E2E REMAINS REQUIRED");

