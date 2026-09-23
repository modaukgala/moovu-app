import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";
const run = promisify(execFile);
const repo = process.cwd(), cwd = resolve("..", ".codex-phase6-release");
const url = process.env.PHASE3_E2E_SUPABASE_URL;
assert.equal(new URL(url).hostname, "tangtlmdpnvmoviwrgvd.supabase.co");
assert.ok(process.env.PHASE3_E2E_SUPABASE_ANON_KEY && process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.PHASE3_E2E_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY, MOOVU_PHASE2_FINANCE_MODE: "AUTHORITATIVE", NEXT_TELEMETRY_DISABLED: "1" };
const npm = resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
for (const [label, cli, args] of [
  ["lockfile", npm, ["install", "--package-lock-only", "--ignore-scripts", "--no-audit"]],
  ["dependencies", npm, ["ci", "--ignore-scripts", "--no-audit"]],
  ["tests", npm, ["test"]],
  ["TypeScript", resolve(repo, "node_modules/typescript/bin/tsc"), ["--noEmit", "--incremental", "false"]],
  ["ESLint", npm, ["run", "lint"]],
  ["build", npm, ["run", "build"]],
]) {
  if (process.env.PHASE6_VALIDATION_STAGES && !process.env.PHASE6_VALIDATION_STAGES.split(",").includes(label)) continue;
  try {
    const stageEnv = { ...env };
    // Baseline unit tests explicitly test the absent-variable OFF fallback.
    if (label === "tests") delete stageEnv.MOOVU_PHASE2_FINANCE_MODE;
    const result = await run(process.execPath, [cli, ...args], { cwd, env: stageEnv, maxBuffer: 8 * 1024 * 1024 });
    let output = result.stdout + result.stderr;
    for (const name of ["PHASE3_E2E_SUPABASE_URL", "PHASE3_E2E_SUPABASE_ANON_KEY", "PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY"]) output = output.replaceAll(process.env[name], "[redacted]");
    console.log(`ISOLATED PHASE 6 ${label} PASSED\n${output.slice(-1400)}`);
  } catch (error) {
    let output = String(error.stdout ?? "") + String(error.stderr ?? "");
    for (const name of ["PHASE3_E2E_SUPABASE_URL", "PHASE3_E2E_SUPABASE_ANON_KEY", "PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY"]) output = output.replaceAll(process.env[name], "[redacted]");
    console.error(`ISOLATED PHASE 6 ${label} FAILED\n${output.slice(-4000)}`); process.exit(1);
  }
}
