import { spawn } from "node:child_process";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const directory = resolve("..", ".codex-phase6-release");
const url = process.env.PHASE3_E2E_SUPABASE_URL;
assert.equal(new URL(url).hostname, "tangtlmdpnvmoviwrgvd.supabase.co");
const base = "http://127.0.0.1:3018";
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.PHASE3_E2E_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY, MOOVU_PHASE2_FINANCE_MODE: "AUTHORITATIVE" };
const server = spawn(process.execPath, [resolve(directory, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3018"], { cwd: directory, env, windowsHide: true, stdio: "ignore" });
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if ((await fetch(`${base}/api/driver/onboarding`, { signal: AbortSignal.timeout(1000) })).status === 401) { ready = true; break; } } catch { /* Cold startup. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Built isolated runtime must start and enforce Auth.");
  for (const path of ["/driver/onboarding", "/driver/apply", "/driver/complete-profile"]) {
    const response = await fetch(base + path); assert.equal(response.status, 200);
    assert.ok((await response.text()).includes("Driver onboarding &amp; re-registration"), "Legacy entry must render the new authenticated flow.");
  }
  for (const path of ["/api/admin/onboarding", "/api/admin/onboarding/retention"]) assert.equal((await fetch(base + path)).status, 401);
  assert.equal((await fetch(`${base}/api/driver/onboarding/evidence?application=00000000-0000-0000-0000-000000000000`)).status, 403);
  for (const path of ["/api/driver/onboarding", "/api/driver/onboarding/evidence", "/api/driver/onboarding/retention"]) assert.equal((await fetch(base + path, { method: "POST", body: "{}" })).status, 401);
  for (const path of ["driver/apply", "driver/profile/save", "driver/documents/upload", "driver/account/delete", "admin/applications/action", "admin/applications/create-driver", "admin/driver-verification", "admin/driver-corrections", "admin/driver-document-review", "admin/driver-docs/upload", "admin/drivers/create", "admin/drivers/remove"]) assert.equal((await fetch(`${base}/api/${path}`, { method: "POST", body: "{}" })).status, 410);
  console.log("PHASE 6 BUILT READ-ONLY HTTP SMOKE PASSED — onboarding aliases / Auth denials / 12 retired mutations; no identities or rows created.");
} finally { server.kill("SIGTERM"); }
