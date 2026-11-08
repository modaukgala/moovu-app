import type { NextConfig } from "next";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

// Local worktrees may share dependencies. Turbopack must see both real paths;
// ordinary installs (including Vercel) retain the project root.
const projectRoot = process.cwd();
const dependencies = path.join(projectRoot, "node_modules");
let filesystemRoot = projectRoot;
if (existsSync(dependencies)) {
  const dependencyRoot = realpathSync(dependencies);
  while (path.relative(filesystemRoot, dependencyRoot).startsWith(`..${path.sep}`)) {
    const parent = path.dirname(filesystemRoot);
    if (parent === filesystemRoot) break;
    filesystemRoot = parent;
  }
}

const nextConfig: NextConfig = {
  turbopack: { root: filesystemRoot },
};

export default nextConfig;
