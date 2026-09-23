import { cp, mkdtemp, symlink, access } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const repo = process.cwd();
const source = process.env.PHASE6_RELEASE_ROOT ? resolve(process.env.PHASE6_RELEASE_ROOT) : repo;
const url = process.env.PHASE3_E2E_SUPABASE_URL;
assert.ok(url && process.env.PHASE3_E2E_SUPABASE_ANON_KEY && process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY, "Disposable credentials required.");
assert.equal(new URL(url).hostname, "tangtlmdpnvmoviwrgvd.supabase.co", "Disposable project guard failed.");
// Next's Windows module paths must remain on the same drive as its dependencies.
const directory = await mkdtemp(join(dirname(repo), ".codex-phase6-http-"));
for (const name of ["src", "public", "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "middleware.ts", "next-env.d.ts"]) {
  try { await access(resolve(source, name)); } catch { continue; }
  await cp(resolve(source, name), join(directory, name), { recursive: true });
}
await symlink(resolve(repo, "node_modules"), join(directory, "node_modules"), "junction");
const base = "http://127.0.0.1:3016";
const environment = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.PHASE3_E2E_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY, MOOVU_PHASE2_FINANCE_MODE: "AUTHORITATIVE", NEXT_TELEMETRY_DISABLED: "1" };
let runtimeError = "";
let firstRuntimeMessages = "";
const server = spawn(process.execPath, [resolve(repo, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3016"], { cwd: directory, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
function capture(chunk) { const message = chunk.toString(); firstRuntimeMessages = (firstRuntimeMessages + message).slice(0, 6000); runtimeError = (runtimeError + message).slice(-1500); }
server.stderr.on("data", capture);
server.stdout.on("data", capture);
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) {
      for (const value of [url, process.env.PHASE3_E2E_SUPABASE_ANON_KEY, process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY]) runtimeError = runtimeError.replaceAll(value, "[redacted]");
      throw new Error(`Local disposable runtime exited: ${runtimeError}`);
    }
    try { const response = await fetch(`${base}/api/driver/onboarding`, { signal: AbortSignal.timeout(3000) }); if (response.status === 401) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) {
    runtimeError = firstRuntimeMessages + runtimeError;
    for (const value of [url, process.env.PHASE3_E2E_SUPABASE_ANON_KEY, process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY]) runtimeError = runtimeError.replaceAll(value, "[redacted]");
    throw new Error(`Local disposable runtime failed to become ready: ${runtimeError}`);
  }
  const test = spawn(process.execPath, [resolve(repo, "scripts/phase6-disposable-e2e.mjs")], { cwd: repo, env: { ...environment, PHASE6_E2E_BASE_URL: base }, stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
  const status = await new Promise(resolve => test.once("exit", resolve));
  assert.equal(status, 0, "Disposable authenticated HTTP validation failed.");
} finally { server.kill("SIGTERM"); }
