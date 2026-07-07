#!/usr/bin/env node
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const markerName = ".moovu-ios-target.json";
const lockPath = join(root, ".moovu-ios-target.lock");
const recoveryDir = join(root, ".moovu-ios-recovery");
const staleLockMs = Number(process.env.MOOVU_IOS_LOCK_STALE_MS || 30 * 60 * 1000);
const iosPath = join(root, "ios");

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

const globalActions = new Set(["clean-locks", "reset-targets"]);
const args = process.argv.slice(2);
const [firstArg, secondArg = "sync"] = args;

if (globalActions.has(firstArg)) {
  if (firstArg === "clean-locks") {
    cleanLocks();
    process.exit(0);
  }

  if (firstArg === "reset-targets") {
    resetTargets();
    process.exit(0);
  }
}

const targetName = firstArg;
const action = secondArg;
const target = targets[targetName];

if (!target) {
  fail(
    "Usage: node scripts/capacitor-ios-target.mjs <customer|driver> <add|copy|sync|open|archive|doctor> OR node scripts/capacitor-ios-target.mjs <clean-locks|reset-targets>",
  );
}

const targetPath = join(root, target.nativeDir);
const markerPath = (dir) => join(dir, markerName);
const appWorkspacePath = join(targetPath, "App", "App.xcworkspace");
const appProjectPath = join(targetPath, "App", "App.xcodeproj");

function fail(message) {
  console.error(`[moovu-ios-target] ${message}`);
  process.exit(1);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureRecoveryDir() {
  mkdirSync(recoveryDir, { recursive: true });
}

function moveToRecovery(pathToMove, label) {
  ensureRecoveryDir();
  const destination = join(recoveryDir, `${label}-${timestamp()}`);
  renameSync(pathToMove, destination);
  console.warn(`[moovu-ios-target] Moved ${pathToMove} to ${destination}.`);
  return destination;
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readMarker(dir) {
  return readJsonFile(markerPath(dir));
}

function writeMarker(dir, markerTargetName = targetName) {
  const markerTarget = targets[markerTargetName];
  if (!markerTarget) fail(`Cannot write marker for unknown target "${markerTargetName}".`);
  const existing = readMarker(dir);

  writeFileSync(
    markerPath(dir),
    JSON.stringify(
      {
        managedBy: "moovu-ios-target-script",
        target: markerTargetName,
        label: markerTarget.label,
        updatedAt: existing?.updatedAt || new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function run(command, runArgs) {
  const executable = process.platform === "win32" && command === "npx" ? "cmd.exe" : command;
  const commandArgs = process.platform === "win32" && command === "npx"
    ? ["/d", "/s", "/c", "npx", ...runArgs]
    : runArgs;
  console.log(`[moovu-ios-target] ${command} ${runArgs.join(" ")}`);
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
    throw new Error(`${command} ${runArgs.join(" ")} failed with exit code ${result.status ?? "unknown"}${reason}.`);
  }
}

function lockFiles() {
  return readdirSync(root)
    .filter((name) => /^\.moovu-ios-target.*\.lock$/.test(name))
    .map((name) => join(root, name));
}

function cleanLocks() {
  let removed = 0;
  for (const path of lockFiles()) {
    try {
      unlinkSync(path);
      removed += 1;
    } catch (error) {
      console.warn(`[moovu-ios-target] Could not remove ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`[moovu-ios-target] Removed ${removed} iOS target lock file(s).`);
}

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === "object" && error.code === "EPERM";
  }
}

function lockInfo() {
  const info = readJsonFile(lockPath) ?? {};
  let ageMs = Number.POSITIVE_INFINITY;

  try {
    ageMs = Date.now() - statSync(lockPath).mtimeMs;
  } catch {}

  return {
    pid: Number.isInteger(info.pid) ? info.pid : null,
    target: typeof info.target === "string" ? info.target : null,
    action: typeof info.action === "string" ? info.action : null,
    ageMs,
  };
}

function removeStaleLockIfSafe() {
  if (!existsSync(lockPath)) return;

  const info = lockInfo();
  const running = processIsRunning(info.pid);
  const stale = !running || info.ageMs > staleLockMs;

  if (!stale) {
    const ageSeconds = Number.isFinite(info.ageMs) ? Math.round(info.ageMs / 1000) : "unknown";
    fail(
      `Another iOS target operation is already running (pid ${info.pid ?? "unknown"}, target ${info.target ?? "unknown"}, action ${info.action ?? "unknown"}, age ${ageSeconds}s). If this is stale, run npm run ios:clean-locks.`,
    );
  }

  unlinkSync(lockPath);
  console.warn("[moovu-ios-target] Removed stale iOS target lock.");
}

async function withTargetLock(callback) {
  removeStaleLockIfSafe();

  let fd;
  try {
    fd = openSync(lockPath, "wx");
    writeFileSync(
      fd,
      JSON.stringify(
        {
          pid: process.pid,
          target: targetName,
          action,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch {
    removeStaleLockIfSafe();
    try {
      fd = openSync(lockPath, "wx");
      writeFileSync(
        fd,
        JSON.stringify(
          {
            pid: process.pid,
            target: targetName,
            action,
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    } catch {
      fail("Another iOS target operation is already running. Run npm run ios:clean-locks only if no iOS command is active.");
    }
  }

  try {
    await callback();
  } finally {
    if (typeof fd === "number") closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      // Lock cleanup failure should not hide the original operation result.
    }
  }
}

function ensureFirebaseMessagingPackage(nativeRoot) {
  const packagePath = join(nativeRoot, "App", "CapApp-SPM", "Package.swift");
  if (!existsSync(packagePath)) {
    fail(`Missing ${packagePath}; cannot configure native Firebase Messaging.`);
  }

  let contents = readFileSync(packagePath, "utf8");
  const pushPackage = '.package(name: "CapacitorPushNotifications", path: "..\\..\\..\\node_modules\\@capacitor\\push-notifications")';
  const firebasePackage = '.package(url: "https://github.com/firebase/firebase-ios-sdk.git", from: "11.0.0")';
  const pushProduct = '.product(name: "CapacitorPushNotifications", package: "CapacitorPushNotifications")';
  const firebaseProducts = [
    '.product(name: "FirebaseCore", package: "firebase-ios-sdk")',
    '.product(name: "FirebaseMessaging", package: "firebase-ios-sdk")',
  ];

  if (!contents.includes(firebasePackage)) {
    contents = contents.replace(pushPackage, `${pushPackage},\n        ${firebasePackage}`);
  }

  if (!contents.includes(firebaseProducts[0]) || !contents.includes(firebaseProducts[1])) {
    contents = contents.replace(
      pushProduct,
      `${pushProduct},\n                ${firebaseProducts.join(",\n                ")}`,
    );
  }

  if (!contents.includes(firebasePackage) || !firebaseProducts.every((product) => contents.includes(product))) {
    fail(`Could not add Firebase Messaging dependencies to ${packagePath}.`);
  }

  writeFileSync(packagePath, contents);
  console.log(`[moovu-ios-target] Firebase Messaging package verified in ${packagePath}.`);
}

function moveManagedIosSlot(preferredTargetName = targetName) {
  if (!existsSync(iosPath)) return false;

  const marker = readMarker(iosPath);
  if (marker?.managedBy !== "moovu-ios-target-script") {
    return false;
  }

  const markerTargetName = marker.target && targets[marker.target] ? marker.target : preferredTargetName;
  const markerTarget = targets[markerTargetName];
  if (!markerTarget) {
    moveToRecovery(iosPath, "ios-unknown-target");
    return true;
  }

  const destination = join(root, markerTarget.nativeDir);

  if (existsSync(destination)) {
    moveToRecovery(iosPath, `ios-stale-${markerTargetName}`);
    return true;
  }

  renameSync(iosPath, destination);
  console.log(`[moovu-ios-target] Recovered managed ios/ folder into ${markerTarget.nativeDir}/.`);
  return true;
}

function assertNoUnmanagedIosFolder() {
  if (!existsSync(iosPath)) return;

  if (moveManagedIosSlot(targetName)) return;

  fail(
    "An unmanaged ios/ folder is present. This script will not delete it automatically. Run npm run ios:reset-targets with MOOVU_IOS_RESET_UNMANAGED=true only after confirming it is safe to move aside.",
  );
}

function resetTargets() {
  cleanLocks();

  if (!existsSync(iosPath)) {
    console.log("[moovu-ios-target] No root ios/ folder to reset.");
    return;
  }

  if (moveManagedIosSlot("customer")) {
    console.log("[moovu-ios-target] Reset complete.");
    return;
  }

  if (process.env.MOOVU_IOS_RESET_UNMANAGED === "true") {
    moveToRecovery(iosPath, "ios-unmanaged");
    console.log("[moovu-ios-target] Unmanaged ios/ moved aside because MOOVU_IOS_RESET_UNMANAGED=true was set.");
    return;
  }

  fail(
    "Root ios/ is unmanaged. To move it aside without deleting ios-customer/ or ios-driver/, rerun with MOOVU_IOS_RESET_UNMANAGED=true npm run ios:reset-targets.",
  );
}

async function addTargetIfMissing() {
  assertNoUnmanagedIosFolder();

  if (existsSync(targetPath)) return;

  if (existsSync(iosPath)) {
    fail("ios/ is still present after recovery checks. Aborting to avoid overwriting native files.");
  }

  run("npx", ["cap", "add", "ios"]);

  if (!existsSync(iosPath)) {
    fail("npx cap add ios finished, but no ios/ folder was created.");
  }

  writeMarker(iosPath, targetName);
  renameSync(iosPath, targetPath);
  console.log(`[moovu-ios-target] Created ${target.nativeDir}/ for ${target.label}.`);
}

async function withTargetAsIos(callback) {
  await addTargetIfMissing();
  assertNoUnmanagedIosFolder();

  if (!existsSync(targetPath)) {
    fail(`${target.nativeDir}/ does not exist and could not be created.`);
  }

  if (existsSync(iosPath)) {
    fail("ios/ is already present after safety checks. Aborting to avoid overwriting native files.");
  }

  renameSync(targetPath, iosPath);
  writeMarker(iosPath, targetName);

  try {
    await callback();
  } finally {
    if (existsSync(iosPath)) {
      writeMarker(iosPath, targetName);

      if (existsSync(targetPath)) {
        moveToRecovery(targetPath, `${target.nativeDir}-unexpected`);
      }

      renameSync(iosPath, targetPath);
      console.log(`[moovu-ios-target] Restored ios/ back to ${target.nativeDir}/.`);
    }
  }
}

async function syncTarget() {
  await withTargetAsIos(async () => {
    run("npx", ["cap", "sync", "ios"]);
    ensureFirebaseMessagingPackage(iosPath);
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
  assertNoUnmanagedIosFolder();

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
  assertNoUnmanagedIosFolder();

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
  const lockInfoOutput = existsSync(lockPath) ? lockInfo() : null;
  const iosMarker = existsSync(iosPath) ? readMarker(iosPath) : null;
  const info = {
    target: targetName,
    label: target.label,
    config: target.config,
    nativeDir: target.nativeDir,
    nativeDirExists: existsSync(targetPath),
    iosFolderExists: existsSync(iosPath),
    iosFolderManaged: iosMarker?.managedBy === "moovu-ios-target-script",
    iosFolderMarkerTarget: iosMarker?.target ?? null,
    lock: lockInfoOutput,
    appWorkspace: appWorkspacePath,
    appProject: appProjectPath,
  };

  console.log(JSON.stringify(info, null, 2));
}

try {
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
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
