import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

async function collect(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collect(path));
    else if (entry.name.endsWith(".test.ts")) output.push(path);
  }
  return output;
}

const files = [...await collect("src/lib"), ...await collect("src/components")].sort();
const result = spawnSync(process.execPath, ["--test", "--experimental-strip-types", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);

