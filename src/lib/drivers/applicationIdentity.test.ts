import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types requires explicit extensions.
import { applicationIdentity } from "./applicationIdentity.ts";
// @ts-expect-error Node strip-types requires explicit extensions.
import { getApplicantSession } from "./applicantSession.ts";

const user = { id: "verified-user", email: "driver@example.test" };
const session = { access_token: "offline-test-only", user };
const input = { email: user.email, password: "offline-test-only", fullName: "Driver", phone: "" };
function authDouble(options: { current?: boolean; login?: boolean; confirmed?: boolean; loginCode?: string } = {}) {
  const calls: string[] = [];
  return {
    calls,
    async getSession() { calls.push("session"); return { data: { session: options.current ? session : null }, error: null }; },
    async signInWithPassword() { calls.push("login"); return { data: { session: options.login ? session : null }, error: options.login ? null : { message: "Confirm your email", code: options.loginCode ?? "invalid_credentials" } }; },
    async signUp() { calls.push("signup"); return { data: { session: options.confirmed ? session : null }, error: null }; },
  };
}
test("anonymous application cannot supply an identity", () => {
  assert.equal(applicationIdentity(null, user.id, user.email).ok, false);
});
test("another user ID or email cannot be adopted", () => {
  assert.equal(applicationIdentity(user, "victim", user.email).ok, false);
  assert.equal(applicationIdentity(user, user.id, "victim@example.test").ok, false);
});
test("verified identity works without trusting body ID or metadata", () => {
  assert.deepEqual(applicationIdentity(user, undefined, " DRIVER@example.test "), { ok: true, userId: user.id, email: user.email });
});
test("returning authenticated applicant reuses session", async () => {
  const auth = authDouble({ current: true });
  assert.equal(await getApplicantSession(auth, input), session);
  assert.deepEqual(auth.calls, ["session"]);
});
test("returning signed-out applicant signs in rather than signing up again", async () => {
  const auth = authDouble({ login: true });
  assert.equal(await getApplicantSession(auth, input), session);
  assert.deepEqual(auth.calls, ["session", "login"]);
});
test("initial signup with immediate session can submit", async () => {
  assert.equal(await getApplicantSession(authDouble({ confirmed: true }), input), session);
});
test("initial email-confirmation signup does not submit without a session", async () => {
  await assert.rejects(getApplicantSession(authDouble(), input), /Confirm your email/);
});
test("unconfirmed returning user does not repeat signup", async () => {
  const auth = authDouble({ loginCode: "email_not_confirmed" });
  await assert.rejects(getApplicantSession(auth, input), /Confirm your email/);
  assert.deepEqual(auth.calls, ["session", "login"]);
});
test("different signed-in account fails without signup or account switching", async () => {
  const auth = authDouble({ current: true });
  await assert.rejects(getApplicantSession(auth, { ...input, email: "other@example.test" }), /different account/);
  assert.deepEqual(auth.calls, ["session"]);
});
