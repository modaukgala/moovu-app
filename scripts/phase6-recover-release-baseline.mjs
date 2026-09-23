import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Recover only reviewed non-secret runtime files through the supported deployment API.
const run = promisify(execFile);
const cli = process.env.PHASE6_VERCEL_CLI;
if (!cli) throw new Error("Supported Vercel CLI entry point required.");
const manifest = JSON.parse(await fs.readFile(path.join(os.tmpdir(), "moovu-phase6-baseline-manifest.json"), "utf8"));
const destination = path.resolve("..", ".codex-phase6-release-baseline");
await fs.mkdir(destination, { recursive: true });
let fetched = 0;
const pending = [...manifest];
await Promise.all(Array.from({ length: 5 }, async () => {
  for (let file; (file = pending.shift());) {
    if (file.path.includes("..") || /(?:\.env|service.account|private.key|google-services|GoogleService|firebase.*json)/i.test(file.path)) throw new Error("Unsafe release file excluded.");
    let bytes;
    try { bytes = await fs.readFile(path.join(destination, file.path)); } catch { /* First recovery. */ }
    if (!bytes || createHash("sha1").update(bytes).digest("hex") !== file.uid) {
      try { bytes = await fs.readFile(file.path); } catch { /* Recover missing baseline through API. */ }
    }
    if (!bytes || createHash("sha1").update(bytes).digest("hex") !== file.uid) {
      const result = await run(process.execPath, [cli, "api", `/v8/deployments/dpl_DXSpah8kBx3VSjep1o9mMneq1ZC1/files/${file.uid}`, "--scope", "kgalaletsos-projects", "--raw"], { maxBuffer: 20 * 1024 * 1024 });
      bytes = Buffer.from(JSON.parse(result.stdout).data, "base64");
      if (createHash("sha1").update(bytes).digest("hex") !== file.uid) throw new Error("Deployed file integrity mismatch.");
      fetched++;
    }
    const target = path.join(destination, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
  }
}));
console.log(`PHASE 6 DEPLOYED BASELINE RECOVERED — ${manifest.length} files; ${fetched} API reads; no environment files.`);
