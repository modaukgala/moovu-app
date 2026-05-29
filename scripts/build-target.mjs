#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const target = process.argv[2]?.trim().toLowerCase();

if (target !== "customer" && target !== "driver") {
  console.error("[moovu-build] Usage: node scripts/build-target.mjs <customer|driver>");
  process.exit(1);
}

const executable = process.platform === "win32" ? "cmd.exe" : "npx";
const args = process.platform === "win32"
  ? ["/d", "/s", "/c", "npx", "next", "build"]
  : ["next", "build"];

console.log(`[moovu-build] Building ${target} web assets`);

const result = spawnSync(executable, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    MOOVU_APP_TARGET: target,
    NEXT_PUBLIC_MOOVU_APP_TARGET: target,
  },
  stdio: "inherit",
  shell: false,
});

if (result.status !== 0) {
  const reason = result.error instanceof Error ? `: ${result.error.message}` : "";
  console.error(`[moovu-build] ${target} build failed with exit code ${result.status ?? "unknown"}${reason}.`);
  process.exit(1);
}
