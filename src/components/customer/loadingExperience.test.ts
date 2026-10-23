import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const base = new URL("../ui/", import.meta.url);
const component = readFileSync(new URL("MoovuLoadingScreen.tsx", base), "utf8");
const scene = readFileSync(new URL("MoovuLoadingScene.tsx", base), "utf8");
const css = readFileSync(new URL("MoovuLoadingScreen.module.css", base), "utf8");

test("loading presentation never adds timers, fetches or readiness delays", () => {
  assert.doesNotMatch(component, /setTimeout|setInterval|fetch\(|requestAnimationFrame/);
  assert.match(component, /removeEventListener\("visibilitychange", update\)/);
  assert.match(component, /document.hidden/);
});
test("brand artwork is preserved and the separate sedan has no taxi sign", () => {
  assert.match(component, /\/Moovu-Black.png/);
  assert.match(component, /Your Kasi Ride\./);
  assert.doesNotMatch(scene, /taxi|toyota|emoji|49cfad/i);
  assert.match(scene, /useId\(\)/);
});
test("vehicle enters forward once and stays still; only route loops", () => {
  assert.match(css, /@keyframes arrive \{ from \{ opacity: 0; transform: translateX\(-65%\); \} to \{ opacity: 1; transform: translateX\(0\); \} \}/);
  assert.doesNotMatch(css, /alternate|reverse|scaleX\(-1\)/);
  assert.match(css, /@keyframes wheel-forward.*rotate\(180deg\)/);
  assert.doesNotMatch(css.match(/\.vehicleEntry \{[^}]+\}/)?.[0] ?? "", /infinite/);
});
test("status semantics, safe areas and reduced motion are supported", () => {
  assert.match(component, /role="status"/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /animation-play-state: paused/);
  assert.doesNotMatch(component, /aria-valuenow/);
});

test("all portal route boundaries and shared data loaders use the same scene", () => {
  const root = new URL("../../", import.meta.url);
  for (const path of ["app/loading.tsx", "app/driver/loading.tsx", "app/admin/loading.tsx"]) {
    const source = readFileSync(new URL(path, root), "utf8");
    assert.match(source, /components\/ui\/MoovuLoadingScreen/);
    assert.match(source, /<MoovuLoadingScreen/);
  }
  const shared = readFileSync(new URL("LoadingState.tsx", base), "utf8");
  assert.match(shared, /<MoovuLoadingScreen/);
  assert.doesNotMatch(shared, /setTimeout|fetch\(/);
});

test("Driver startup and Admin authorization keep existing loading gates", () => {
  const root = new URL("../../", import.meta.url);
  const driver = readFileSync(new URL("app/driver/page.tsx", root), "utf8");
  const admin = readFileSync(new URL("app/admin/(protected)/layout.tsx", root), "utf8");
  assert.match(driver, /if \(loadingDriver\) \{\s*return <MoovuLoadingScreen/);
  assert.match(admin, /if \(checking\) \{\s*return <MoovuLoadingScreen/);
  assert.match(driver, /useReliableRead/);
  assert.match(admin, /supabaseClient.auth.getSession/);
});
