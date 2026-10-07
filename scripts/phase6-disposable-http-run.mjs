// Run the existing authenticated Phase 6 HTTP journey against disposable Supabase only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomBytes } from "node:crypto";
import webpush from "web-push";

const url = process.env.PHASE3_E2E_SUPABASE_URL;
const anonKey = process.env.PHASE3_E2E_SUPABASE_ANON_KEY;
const serviceKey = process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && anonKey && serviceKey, "Disposable credentials unavailable");
assert.equal(new URL(url).hostname, "tangtlmdpnvmoviwrgvd.supabase.co", "Disposable project guard failed");
const host = "127.0.0.1";
const reserve = createServer(); reserve.listen(0, host); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(done => reserve.close(done));
const base = `http://${host}:${port}`;
const vapid = webpush.generateVAPIDKeys();
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey, YOCO_ENVIRONMENT: "test", YOCO_SECRET_KEY: "",
  OUTBOX_JOB_SECRET: randomBytes(32).toString("hex"), PHASE05_OUTBOX_ENABLED: "true",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:phase6-disposable@example.invalid",
  FIREBASE_PROJECT_ID: "", FIREBASE_CLIENT_EMAIL: "", FIREBASE_PRIVATE_KEY: "",
  PHASE6_E2E_BASE_URL: base };
const app = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--hostname", host, "--port", String(port)],
  { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
app.stdout.resume(); app.stderr.resume();
try {
  let ready = false;
  for (let i = 0; i < 240; i++) {
    if (app.exitCode !== null) break;
    try { if ((await fetch(`${base}/driver/login`)).ok) { ready = true; break; } } catch { /* starting */ }
    await delay(500);
  }
  assert.ok(ready, "Disposable local Driver runtime unavailable");
  const test = spawn(process.execPath, [resolve("scripts/phase6-disposable-e2e.mjs")],
    { env, stdio: "inherit", windowsHide: true });
  const [code] = await once(test, "exit");
  assert.equal(code, 0, "Authenticated disposable Phase 6 HTTP journey failed");
  console.log("PHASE6_DISPOSABLE_AUTHENTICATED_HTTP_PASS");
} finally { app.kill(); }
