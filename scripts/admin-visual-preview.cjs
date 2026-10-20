// Local-only visual fixture. Every API response is synthetic and all writes are denied.
/* eslint-disable @typescript-eslint/no-require-imports -- Browser package comes from the local Codex runtime. */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const baseUrl = process.env.MOOVU_VISUAL_BASE_URL || "http://localhost:3599";
const origin = new URL(baseUrl);
if (!["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("Local preview only");
const output = process.env.MOOVU_VISUAL_OUTPUT_DIR
  ? path.resolve(process.env.MOOVU_VISUAL_OUTPUT_DIR)
  : path.join(__dirname, "..", "docs", "admin-premium-preview-screenshots");
const sizes = [[360, 740], [390, 844], [412, 915], [768, 1024], [1280, 800], [1440, 900]];
const adminId = "00000000-0000-4000-8000-000000000111";
const driverId = "00000000-0000-4000-8000-000000000201";
const tripId = "00000000-0000-4000-8000-000000000301";
const applicationId = "00000000-0000-4000-8000-000000000401";
const session = {
  access_token: "synthetic-local-admin-preview",
  refresh_token: "synthetic-local-admin-refresh",
  token_type: "bearer",
  expires_in: 86400,
  expires_at: Math.floor(Date.now() / 1000) + 86400,
  user: { id: adminId, aud: "authenticated", role: "authenticated", email: "preview-admin@example.invalid",
    app_metadata: { provider: "email", providers: ["email"], role: "admin" },
    user_metadata: { role: "admin" }, created_at: "2026-01-01T00:00:00.000Z" },
};
const analytics = {
  today_completed_trips: 8, today_cancelled_trips: 1, today_gross_revenue: 680,
  today_commission_owed: 102, weekly_trips: 43, monthly_trips: 182,
  active_drivers: 12, online_drivers: 5, pending_driver_applications: 0,
  pending_driver_applications_as_of: "2026-10-20T08:00:00.000Z",
  active_subscriptions: 0, expiring_subscriptions: 0, average_fare: 85,
  cancellation_rate: 0.02, scheduled_due_next_hour: 0, scheduled_total_pending: 0,
  open_support_issues: 1, low_rated_drivers: [], recent_cancellations: [],
  top_drivers: [], generated_at: "2026-10-20T08:00:00.000Z",
};
const drivers = [
  { id: driverId, first_name: "Alex", last_name: "Preview", phone: "0000000000", email: "alex@example.invalid", status: "approved" },
  { id: "00000000-0000-4000-8000-000000000202", first_name: "Sam", last_name: "Fixture", phone: "0000000001", email: "sam@example.invalid", status: "pending" },
];
const screens = [
  ["dashboard", "/admin"],
  ["drivers", "/admin/drivers"],
  ["trips", "/admin/trips"],
  ["applications", "/admin/applications"],
  ["earnings", "/admin/earnings"],
  ["driver-profile", `/admin/drivers/${driverId}`],
  ["onboarding-review", "/admin/onboarding"],
  ["application-detail", "/admin/onboarding"],
  ["review-dialog", "/admin/onboarding"],
  ["trip-detail", `/admin/trips/${tripId}`],
  ["dispatch", "/admin/dispatch"],
  ["commissions", "/admin/commission-payments"],
  ["settlements", "/admin/settlements"],
  ["subscriptions", "/admin/subscriptions"],
  ["payment-reviews", "/admin/payment-reviews"],
];
const isCore = (name) => ["dashboard", "drivers", "trips", "applications", "earnings"].includes(name);
const selectedScreens = (width) => screens.filter(([name]) =>
  (!process.env.MOOVU_VISUAL_SCREEN || process.env.MOOVU_VISUAL_SCREEN === name) &&
  (isCore(name) || [390, 768, 1440].includes(width)));
const application = { id: applicationId, driver_id: driverId, cycle: 1, revision: 1, version: 1, status: "UNDER_REVIEW", draft: {
  personal: { first_name: "Alex", last_name: "Preview", phone: "0000000000", area_name: "Fixture area" },
  driving: { license_number: "SYNTHETIC" },
  vehicle: { vehicle_make: "Toyota", vehicle_model: "Corolla", vehicle_registration: "FIXTURE" },
}, correction_sections: [] };
const trip = { id: tripId, driver_id: driverId, rider_name: "Taylor Fixture", rider_phone: "0000000002",
  pickup_address: "Fixture pickup", dropoff_address: "Fixture destination", payment_method: "cash",
  fare_amount: 85, estimated_fare: 85, original_fare: 85, final_fare: 85,
  status: "assigned", cancel_reason: null, created_at: "2026-10-20T08:00:00.000Z",
  offer_status: "accepted", offer_expires_at: null, stops: [],
};

async function main() {
  fs.mkdirSync(output, { recursive: true });
  if (!process.env.MOOVU_VISUAL_SCREEN) {
    for (const [width, height] of sizes.filter(([width, height]) => !process.env.MOOVU_VISUAL_VIEWPORT || process.env.MOOVU_VISUAL_VIEWPORT === `${width}x${height}`)) {
      for (const [name] of selectedScreens(width)) {
        let passed = false;
        for (let attempt = 0; attempt < 2 && !passed; attempt += 1) {
          const result = spawnSync(process.execPath, [__filename], {
            env: { ...process.env, MOOVU_VISUAL_SCREEN: name, MOOVU_VISUAL_VIEWPORT: `${width}x${height}` },
            stdio: "inherit",
          });
          passed = result.status === 0;
        }
        if (!passed) throw new Error(`${name} fixture failed at ${width}x${height}`);
      }
    }
    return;
  }
  for (const [width, height] of sizes.filter(([width, height]) => !process.env.MOOVU_VISUAL_VIEWPORT || process.env.MOOVU_VISUAL_VIEWPORT === `${width}x${height}`)) {
    for (const [name, pathname] of selectedScreens(width)) {
      const browser = await chromium.launch({ headless: true, ...(process.env.MOOVU_VISUAL_BROWSER ? { executablePath: process.env.MOOVU_VISUAL_BROWSER } : {}) });
      try {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: "block" });
      await context.addInitScript((value) => {
        for (const key of ["sb-127-auth-token", "sb-localhost-auth-token", "sb-127.0.0.1-auth-token"]) localStorage.setItem(key, JSON.stringify(value));
        document.addEventListener("DOMContentLoaded", () => {
          const style = document.createElement("style");
          style.textContent = "nextjs-portal { display: none !important; }";
          document.head.appendChild(style);
        }, { once: true });
      }, session);
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin.origin) return route.abort();
        if (!url.pathname.startsWith("/api/")) return route.continue();
        const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (route.request().method() !== "GET") return json({ ok: false, error: "Visual fixture is read-only" }, 403);
        if (url.pathname === "/api/admin/analytics") return json({ ok: true, analytics });
        if (url.pathname === "/api/admin/pricing/surge") return json({ ok: true, surge: { mode: "normal", label: "Normal", multiplier: 1, message: "Standard pricing" } });
        if (url.pathname === "/api/admin/application-summary") return json({ ok: true, needsReview: { count: 0 } });
        if (url.pathname === "/api/admin/payment-reviews") return json({ ok: true, requests: [] });
        if (url.pathname === "/api/admin/drivers/list") return json({ ok: true, drivers });
        if (url.pathname === "/api/admin/drivers/options") return json({ ok: true, drivers });
        if (url.pathname === "/api/admin/trips/list") return json({ ok: true, trips: [] });
        if (url.pathname === "/api/admin/driver-profile") return json({ ok: true, profile: { ...drivers[0], online: false, busy: false, profile_completed: true, verification_status: "approved", vehicle_make: "Toyota", vehicle_model: "Corolla", vehicle_registration: "FIXTURE", driver_profile: {} }, documents: [], document_checks: [], readiness: { checklist: [] }, validation_issues: [], corrections: [], review_notes: [] });
        if (url.pathname === `/api/admin/trips/${tripId}`) return json({ ok: true, trip, events: [], drivers: [{ ...drivers[0], online: false, busy: true }] });
        if (url.pathname === "/api/admin/dispatch/board") return json({ ok: true, rows: [] });
        if (url.pathname === "/api/admin/commission-balances") return json({ ok: true, rows: [], total_drivers: 0 });
        if (url.pathname === "/api/admin/subscriptions/drivers") return json({ ok: true, drivers });
        if (url.pathname === "/api/admin/subscriptions/history") return json({ ok: true, events: [] });
        if (url.pathname === "/api/admin/onboarding") {
          if (url.searchParams.has("id")) return json({ application, driverName: "Alex Preview", existingDriver: false,
            versions: [{ version: 1, snapshot: { draft: application.draft }, submitted_at: "2026-10-20T08:00:00.000Z" }], reviews: [], uploads: [] });
          return json({ ok: true, applications: [{ id: applicationId, status: "UNDER_REVIEW", cycle: 1,
            updated_at: "2026-10-20T08:00:00.000Z", driverName: "Alex Preview", existingDriver: false,
            completion: { received: 3, total: 12, missing: 9 } }] });
        }
        if (url.pathname === "/api/admin/earnings") return json({ ok: true, drivers: [], trips: [], summary: {} });
        if (url.pathname === "/api/notifications/status") return json({ ok: true, activeTokenCount: 1 });
        return json({ ok: true, data: [], items: [], applications: [] });
      });
        const page = await context.newPage();
        await page.goto(`${baseUrl}${pathname}`, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.locator(".moovu-admin-content").waitFor({ timeout: 20000 }).catch(async () => {
          const state = await page.evaluate(() => ({ path: location.pathname, storedSession: Boolean(localStorage.getItem("sb-127-auth-token")), title: document.querySelector("h1")?.textContent ?? null }));
          throw new Error(`${name} did not render Admin content at ${width}x${height}; ${JSON.stringify(state)}`);
        });
        if (name === "application-detail" || name === "review-dialog") {
          await page.getByRole("button", { name: /Alex Preview/ }).first().click();
          await page.getByRole("heading", { name: "Personal information" }).waitFor({ timeout: 10000 });
          if (name === "review-dialog") {
            await page.getByRole("button", { name: "Request re-upload" }).first().click();
            await page.getByRole("dialog").waitFor({ timeout: 10000 });
          }
        }
        await page.waitForTimeout(500);
        const state = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, heading: document.querySelector("h1")?.textContent ?? null }));
        if (state.scrollWidth > state.width + 1) {
          const offenders = await page.evaluate(() => [...document.querySelectorAll("body *")]
            .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
            .slice(0, 8).map((element) => ({ tag: element.tagName, className: String(element.className).slice(0, 120), right: Math.round(element.getBoundingClientRect().right) })));
          throw new Error(`${name} overflows at ${width}x${height}: ${state.scrollWidth}; ${JSON.stringify(offenders)}`);
        }
        const file = `${name}-${width}x${height}.png`;
        await page.screenshot({ path: path.join(output, file), fullPage: name !== "review-dialog" });
        process.stdout.write(`${JSON.stringify({ name, viewport: `${width}x${height}`, file, ...state })}\n`);
        if (name === "earnings" && width < 1024) {
          await page.getByRole("button", { name: "Open Admin navigation" }).click();
          await page.getByRole("dialog", { name: "Admin navigation" }).waitFor();
          await page.screenshot({ path: path.join(output, `navigation-${width}x${height}.png`) });
        }
        await page.close();
      await context.close();
      } finally { await browser.close(); }
      }
  }
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
