import fs from "node:fs/promises";
import path from "node:path";
const roots = ["src/lib/drivers", "src/components/driver", "src/app/api/driver/onboarding", "src/app/api/admin/onboarding", "src/app/driver/onboarding", "src/app/admin/(protected)/onboarding", "scripts", "supabase/migrations"];
const files = [];
async function walk(directory) { for (const item of await fs.readdir(directory, { withFileTypes: true })) { const file = path.join(directory, item.name); if (item.isDirectory()) await walk(file); else if (/phase6|phase-6|onboarding/i.test(file)) files.push(file); } }
for (const root of roots) await walk(root);
const manifest = JSON.parse(await fs.readFile(path.resolve("..", ".codex-phase6-release/phase6-release-manifest.json"), "utf8"));
for (const file of manifest.runtimeFiles) if (!files.includes(file)) files.push(file);
const secrets = ["PHASE3_E2E_SUPABASE_ANON_KEY", "PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY"].map(name => process.env[name]).filter(Boolean);
if (secrets.length !== 2) throw new Error("Credential scan requires the guarded child environment.");
let failed = false;
const uniqueFiles = [...new Set(files.map(file => path.normalize(file)))];
for (const file of uniqueFiles) {
  const text = await fs.readFile(file, "utf8");
  if (secrets.some(value => text.includes(value)) || /sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(text)) failed = true;
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    try { if (JSON.parse(Buffer.from(token.split(".")[1], "base64url")).role === "service_role") failed = true; } catch { /* Noncredential example. */ }
  }
}
let bundleFiles = 0;
async function scanBundle(directory) {
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await scanBundle(file);
    else if (/\.(?:js|json|map)$/.test(file)) {
      bundleFiles++;
      if ((await fs.readFile(file, "utf8")).includes(process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY)) failed = true;
    }
  }
}
await scanBundle(path.resolve("..", ".codex-phase6-release/.next/static"));
console.log(failed ? "PHASE 6 SCOPED CREDENTIAL SCAN BLOCKED — literal credential detected; values withheld." : `PHASE 6 SCOPED CREDENTIAL SCAN PASSED — ${uniqueFiles.length} source files / ${bundleFiles} browser bundle files; no credential values emitted.`);
process.exitCode = failed ? 1 : 0;
