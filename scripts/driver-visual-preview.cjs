// Isolated visual preview: only localhost pages and synthetic, read-only API replies.
/* eslint-disable @typescript-eslint/no-require-imports -- Playwright is supplied by the local bundled runtime. */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.env.MOOVU_VISUAL_BASE_URL || "http://localhost:3598";
const browserPath = process.env.MOOVU_VISUAL_BROWSER;
const origin = new URL(baseUrl);
if (!["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("Local visual preview only");
const outputDir = path.join(__dirname, "..", "docs", "driver-premium-simple-screenshots");
const viewports = [
  { name: "android-small", width: 360, height: 740 },
  { name: "android-standard", width: 412, height: 915 },
  { name: "iphone", width: 390, height: 844 },
];
const driverId = "00000000-0000-4000-8000-000000000201";
const tripId = "00000000-0000-4000-8000-000000000301";
const driver = {
  id: driverId, first_name: "Preview", last_name: "Driver", phone: "0000000000", status: "approved",
  online: false, busy: false, profile_completed: true, verification_status: "approved",
  vehicle_make: "Toyota", vehicle_model: "Corolla", vehicle_registration: "PREVIEW",
  lat: null, lng: null, last_seen: null,
};
const trip = {
  id: tripId, status: "assigned", driver_id: driverId, rider_name: "Preview Customer", rider_phone: null,
  pickup_address: "Preview pickup, Siyabuswa", dropoff_address: "Preview destination, Siyabuswa",
  pickup_lat: -25.113, pickup_lng: 29.045, dropoff_lat: -25.12, dropoff_lng: 29.07,
  fare_amount: 85, final_fare: 85, ride_option: "go", payment_method: "cash",
  created_at: "2026-10-19T08:00:00.000Z", no_show_eligible_at: null,
};
const completed = { ...trip, status: "completed", completed_at: "2026-10-19T08:30:00.000Z", driver_net_earnings: 72.25, commission_amount: 12.75 };
const session = {
  access_token: "synthetic-local-driver-preview", refresh_token: "synthetic-local-driver-refresh",
  token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400,
  user: { id: driverId, aud: "authenticated", role: "authenticated", email: "preview-driver@example.invalid",
    app_metadata: { provider: "email", providers: ["email"], role: "driver" }, user_metadata: { role: "driver" },
    created_at: "2026-01-01T00:00:00.000Z" },
};

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
  try {
    for (const viewport of viewports.filter((item) => !process.env.MOOVU_VISUAL_VIEWPORT || item.name === process.env.MOOVU_VISUAL_VIEWPORT)) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: "block" });
      await context.grantPermissions(["geolocation"], { origin: origin.origin });
      await context.setGeolocation({ latitude: -25.113, longitude: 29.045 });
      await context.addInitScript((value) => {
        for (const key of ["sb-127-auth-token", "sb-localhost-auth-token", "sb-127.0.0.1-auth-token"]) localStorage.setItem(key, JSON.stringify(value));
        document.addEventListener("DOMContentLoaded", () => {
          const style = document.createElement("style");
          style.textContent = "nextjs-portal { display: none !important; }";
          document.head.appendChild(style);
        }, { once: true });
      }, session);
      let online = false;
      let activeStatus = null;
      let offerActive = false;
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin.origin) return route.abort();
        if (url.pathname.startsWith("/api/")) {
          const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
          if (request.method() !== "GET") {
            if (url.pathname === "/api/driver/heartbeat") return json({ ok: true });
            return json({ ok: false, error: "Synthetic preview blocks mutations" }, 403);
          }
          if (url.pathname === "/api/driver/me") return json({ ok: true, driver: { ...driver, online } });
          if (url.pathname === "/api/driver/offers/current") return json({ ok: true, offer: offerActive ? {
            ...trip, status: "offered", offer_status: "pending", offer_expires_at: new Date(Date.now() + 45000).toISOString(),
            distance_km: 5.4, duration_min: 12,
          } : null });
          if (url.pathname === "/api/driver/current-trip") return json({ ok: true, trip: activeStatus ? { ...trip, status: activeStatus } : null });
          if (url.pathname === "/api/driver/history") return json({ ok: true, trips: [completed] });
          if (url.pathname === "/api/driver/earnings") return json({ ok: true, earnings: {
            driver, wallet: { balance_due: 12.75, total_driver_net: 72.25, total_trips_completed: 1 },
            recent_completed_trips: [completed], payment_requests: [], settlements: [], subscription_payments: [],
            cancellation_fees: [], commission_breakdown: [], cancellation_driver_earnings: 0,
            late_cancellation_driver_earnings: 0, no_show_driver_earnings: 0,
          } });
          if (url.pathname === "/api/notifications/status") return json({ ok: true, activeTokenCount: 1, activeDeviceTokenCount: 1 });
          return json({ ok: true });
        }
        return route.continue();
      });
      const page = await context.newPage();
      async function open(name, pathname, marker) {
        await page.goto(`${baseUrl}${pathname}`, { waitUntil: "domcontentloaded" });
        await page.locator(marker).waitFor({ timeout: 20000 });
        await page.waitForTimeout(250);
        const reminderDismiss = page.getByRole("button", { name: "Not now" });
        if (await reminderDismiss.isVisible().catch(() => false)) await reminderDismiss.click();
        const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
        if (dimensions.scrollWidth > dimensions.clientWidth + 1) throw new Error(`${name}: horizontal overflow at ${viewport.name}`);
        const filename = `${name}-${viewport.name}.png`;
        await page.screenshot({ path: path.join(outputDir, filename) });
        console.log(JSON.stringify({ screen: name, viewport: viewport.name, file: filename, ...dimensions }));
      }
      await open("01-offline", "/driver", ".driver-availability-copy");
      online = true;
      await open("02-online", "/driver", ".driver-availability-copy");
      offerActive = true;
      await open("03-incoming-offer", "/driver", ".moovu-driver-offer-drop");
      await page.waitForTimeout(1100);
      await page.screenshot({ path: path.join(outputDir, `04-offer-countdown-${viewport.name}.png`) });
      offerActive = false;
      await open("05-offer-expired", "/driver?offerExpired=1", ".driver-availability-copy");
      for (const [name, status] of [["06-accepted-trip", "assigned"], ["08-arrived", "arrived"], ["10-trip-in-progress", "ongoing"]]) {
        activeStatus = status;
        await open(name, "/driver", ".moovu-driver-active-trip.is-open");
        if (status === "assigned") {
          await page.getByRole("button", { name: /Drive to pickup/ }).click();
          await page.locator(".moovu-driver-nav-sheet").waitFor();
          await page.screenshot({ path: path.join(outputDir, `07-navigate-to-pickup-${viewport.name}.png`) });
        }
        if (status === "arrived") {
          await page.getByRole("button", { name: "Enter start OTP" }).click();
          await page.screenshot({ path: path.join(outputDir, `09-start-otp-${viewport.name}.png`) });
        }
        if (status === "ongoing") {
          await page.getByRole("button", { name: "Complete with End OTP" }).click();
          await page.screenshot({ path: path.join(outputDir, `11-end-otp-${viewport.name}.png`) });
        }
      }
      activeStatus = null;
      await open("12-trip-completed", "/driver/history", ".driver-trip-row");
      await open("13-earnings", "/driver/earnings", ".driver-money-grid");
      await open("14-trip-history", "/driver/history", ".driver-trip-list");
      await open("15-account", "/driver/account", ".driver-account-heading");
      await open("16-support", "/driver/contact", ".legal-hero");
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
