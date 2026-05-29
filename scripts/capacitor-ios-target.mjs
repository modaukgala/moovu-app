#!/usr/bin/env node
import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const markerName = ".moovu-ios-target.json";
const lockPath = join(root, ".moovu-ios-target.lock");

const targets = {
  customer: {
    label: "MOOVU Customer",
    config: "capacitor.customer.config.ts",
    nativeDir: "ios-customer",
  },
  driver: {
    label: "MOOVU Driver",
    config: "capacitor.driver.config.ts",
    nativeDir: "ios-driver",
  },
};

const [targetName, action = "sync"] = process.argv.slice(2);
const target = targets[targetName];

if (!target) {
  fail("Usage: node scripts/capacitor-ios-target.mjs <customer|driver> <add|copy|sync|open|archive|doctor>");
}

const iosPath = join(root, "ios");
const targetPath = join(root, target.nativeDir);
const markerPath = (dir) => join(dir, markerName);
const appWorkspacePath = join(targetPath, "App", "App.xcworkspace");
const appProjectPath = join(targetPath, "App", "App.xcodeproj");

function fail(message) {
  console.error(`[moovu-ios-target] ${message}`);
  process.exit(1);
}

function readMarker(dir) {
  try {
    return JSON.parse(readFileSync(markerPath(dir), "utf8"));
  } catch {
    return null;
  }
}

function writeMarker(dir) {
  writeFileSync(
    markerPath(dir),
    JSON.stringify(
      {
        managedBy: "moovu-ios-target-script",
        target: targetName,
        label: target.label,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function run(command, args) {
  const executable = process.platform === "win32" && command === "npx" ? "cmd.exe" : command;
  const commandArgs = process.platform === "win32" && command === "npx"
    ? ["/d", "/s", "/c", "npx", ...args]
    : args;
  console.log(`[moovu-ios-target] ${command} ${args.join(" ")}`);
  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    env: {
      ...process.env,
      CAPACITOR_TARGET: targetName,
    },
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    const reason = result.error instanceof Error ? `: ${result.error.message}` : "";
    fail(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}${reason}.`);
  }
}

async function withTargetLock(callback) {
  let fd;
  try {
    fd = openSync(lockPath, "wx");
  } catch {
    fail("Another iOS target operation is already running. Wait for it to finish before running another iOS command.");
  }

  try {
    await callback();
  } finally {
    if (typeof fd === "number") closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      // Lock cleanup failure should not hide a successful sync.
    }
  }
}

function assertSafeIosSlot() {
  if (!existsSync(iosPath)) return;

  const marker = readMarker(iosPath);
  if (!marker?.managedBy || marker.managedBy !== "moovu-ios-target-script") {
    fail(
      "An existing ios/ folder is present and is not managed by this script. Move it aside manually before running split iOS target scripts.",
    );
  }

  if (marker.target && marker.target !== targetName) {
    const other = targets[marker.target];
    if (!other) fail("ios/ contains an unknown managed target.");
    const otherPath = join(root, other.nativeDir);
    if (existsSync(otherPath)) {
      fail(`ios/ contains ${marker.target}, but ${other.nativeDir}/ already exists. Resolve this manually first.`);
    }
    renameSync(iosPath, otherPath);
  }
}

async function addTargetIfMissing() {
  if (existsSync(targetPath)) return;

  assertSafeIosSlot();
  if (existsSync(iosPath)) {
    fail("ios/ already exists. Move or sync it before adding another iOS target.");
  }

  run("npx", ["cap", "add", "ios"]);

  writeMarker(iosPath);
  renameSync(iosPath, targetPath);
  console.log(`[moovu-ios-target] Created ${target.nativeDir}/ for ${target.label}.`);
}

async function withTargetAsIos(callback) {
  await addTargetIfMissing();
  assertSafeIosSlot();

  if (existsSync(iosPath)) {
    fail("ios/ is already present after safety checks. Aborting to avoid overwriting native files.");
  }

  renameSync(targetPath, iosPath);
  writeMarker(iosPath);

  try {
    await callback();
  } finally {
    writeMarker(iosPath);
    if (existsSync(targetPath)) {
      const backup = `${targetPath}.backup-${Date.now()}`;
      renameSync(targetPath, backup);
      console.warn(`[moovu-ios-target] Existing ${target.nativeDir}/ moved to ${backup}.`);
    }
    renameSync(iosPath, targetPath);
  }
}

async function syncTarget() {
  await withTargetAsIos(async () => {
    run("npx", ["cap", "sync", "ios"]);
  });

  console.log(`[moovu-ios-target] Synced ${target.label} in ${target.nativeDir}/.`);
}

async function copyTarget() {
  await withTargetAsIos(async () => {
    run("npx", ["cap", "copy", "ios"]);
  });

  console.log(`[moovu-ios-target] Copied web assets for ${target.label} into ${target.nativeDir}/.`);
}

function openTarget() {
  if (!existsSync(targetPath)) {
    fail(`${target.nativeDir}/ does not exist yet. Run npm run ios:${targetName}:add first.`);
  }

  const openPath = existsSync(appWorkspacePath) ? appWorkspacePath : appProjectPath;
  if (!existsSync(openPath)) {
    fail(`Could not find ${appWorkspacePath} or ${appProjectPath}.`);
  }

  if (process.platform === "darwin") {
    run("open", [openPath]);
  } else {
    console.log(`[moovu-ios-target] Open this on Mac: ${openPath}`);
  }
}

function archiveTarget() {
  if (!existsSync(targetPath)) {
    fail(`${target.nativeDir}/ does not exist yet. Run npm run sync:${targetName} first.`);
  }

  const workspacePath = existsSync(appWorkspacePath) ? appWorkspacePath : null;
  if (!workspacePath) {
    fail(`Could not find ${appWorkspacePath}. Run npm run sync:${targetName} first.`);
  }

  const archivePath = join(root, "build", targetName === "customer" ? "MOOVU-Customer.xcarchive" : "MOOVU-Driver.xcarchive");
  run("xcodebuild", [
    "archive",
    "-workspace",
    workspacePath,
    "-scheme",
    "App",
    "-configuration",
    "Release",
    "-destination",
    "generic/platform=iOS",
    "-archivePath",
    archivePath,
  ]);
}

function doctor() {
  const info = {
    target: targetName,
    label: target.label,
    config: target.config,
    nativeDir: target.nativeDir,
    nativeDirExists: existsSync(targetPath),
    iosFolderExists: existsSync(iosPath),
    appWorkspace: appWorkspacePath,
    appProject: appProjectPath,
  };

  console.log(JSON.stringify(info, null, 2));
}

switch (action) {
  case "add":
    await withTargetLock(addTargetIfMissing);
    break;
  case "copy":
    await withTargetLock(copyTarget);
    break;
  case "sync":
    await withTargetLock(syncTarget);
    break;
  case "open":
    openTarget();
    break;
  case "archive":
    archiveTarget();
    break;
  case "doctor":
    doctor();
    break;
  default:
    fail(`Unknown action "${action}". Use add, copy, sync, open, archive, or doctor.`);
}
