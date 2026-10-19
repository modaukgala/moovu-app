// Local-only browser preview. Every API request is intercepted and external hosts are blocked.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS keeps the bundled Playwright package resolvable through NODE_PATH on this host. */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.env.MOOVU_VISUAL_BASE_URL || "http://localhost:3596";
const browserPath = process.env.MOOVU_VISUAL_BROWSER;
const parsedBase = new URL(baseUrl);
const outputDir = path.join(__dirname, "..", "docs", "customer-uiux-screenshots");
const tripId = "00000000-0000-4000-8000-000000000301";
const viewports = [
  { name: "android-small", width: 360, height: 740 },
  { name: "android-standard", width: 412, height: 915 },
  { name: "iphone", width: 390, height: 844 },
];
if (!["localhost", "127.0.0.1"].includes(parsedBase.hostname)) {
  throw new Error("Visual preview only accepts a localhost application URL.");
}

const customer = {
  id: "00000000-0000-4000-8000-000000000101",
  first_name: "Preview",
  last_name: "Customer",
  email: "preview-customer@example.invalid",
  phone: "0000000000",
};
const session = {
  access_token: "synthetic-local-preview-token",
  refresh_token: "synthetic-local-preview-refresh",
  token_type: "bearer",
  expires_in: 86400,
  expires_at: Math.floor(Date.now() / 1000) + 86400,
  user: {
    id: customer.id,
    aud: "authenticated",
    role: "authenticated",
    email: customer.email,
    app_metadata: { provider: "email", providers: ["email"], role: "customer" },
    user_metadata: { role: "customer" },
    created_at: "2026-01-01T00:00:00.000Z",
  },
};

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(browserPath ? { executablePath: browserPath } : {}),
  });
  try {
    for (const viewport of viewports.filter((item) => !process.env.MOOVU_VISUAL_VIEWPORT || process.env.MOOVU_VISUAL_VIEWPORT === item.name)) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: "block" });
      await context.grantPermissions(["notifications"], { origin: parsedBase.origin });
      await context.addInitScript((value) => {
        for (const key of ["sb-127-auth-token", "sb-localhost-auth-token", "sb-127.0.0.1-auth-token"]) {
          localStorage.setItem(key, JSON.stringify(value));
        }
      }, session);
      let tripStatus = "offered";
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== parsedBase.origin) return route.abort();
        const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        if (url.pathname === "/api/customer/me") return json({ ok: true, customer, legalAcceptance: { accepted: true } });
        if (url.pathname === "/api/customer/active-trip") return json({ ok: true, destination: null });
        if (url.pathname === "/api/customer/trips") return json({ ok: true, trips: [] });
        if (url.pathname === "/api/notifications/status") return json({ ok: true, activeTokenCount: 1, activeDeviceTokenCount: 1 });
        if (url.pathname === "/api/pricing/surge") return json({ ok: true, surge: { mode: "normal", multiplier: 1 } });
        if (url.pathname === "/api/maps/autocomplete") {
          const input = String(route.request().postDataJSON()?.input || "");
          const pickup = /pickup/i.test(input);
          return json({ ok: true, predictions: [{ description: pickup ? "Preview Pickup, Siyabuswa" : "Preview Destination, Siyabuswa", place_id: pickup ? "preview-pickup" : "preview-destination" }] });
        }
        if (url.pathname === "/api/maps/place-details") {
          const pickup = route.request().postDataJSON()?.place_id === "preview-pickup";
          return json({ ok: true, place_id: pickup ? "preview-pickup" : "preview-destination", name: pickup ? "Preview Pickup" : "Preview Destination", lat: pickup ? -25.113 : -25.12, lng: pickup ? 29.045 : 29.07 });
        }
        if (url.pathname === "/api/maps/distance") return json({ ok: true, distanceKm: 5.4, durationMin: 12, originalDistanceKm: 5.4, originalDurationMin: 12, routeQuote: "synthetic-preview-route" });
        if (url.pathname === "/api/customer/phase5-quote") {
          const amount = route.request().postDataJSON()?.rideOption === "group" ? 11900 : 8500;
          return json({ authority: "PHASE5", quote: { rideFareCents: amount, grossServiceFeeCents: 0, membershipWaiverCents: 0, promotionalCreditCents: 0, customerTotalCents: amount, driverFareBasisCents: amount } });
        }
        if (url.pathname === "/api/customer/trip-status") {
          const assigned = !["requested", "offered"].includes(tripStatus);
          return json({ ok: true, trip: {
            id: tripId, status: tripStatus, pickup_address: "Preview Pickup, Siyabuswa", dropoff_address: "Preview Destination, Siyabuswa",
            pickup_lat: -25.113, pickup_lng: 29.045, dropoff_lat: -25.12, dropoff_lng: 29.07,
            distance_km: 5.4, duration_min: 12, fare_amount: 85, original_fare: 85, final_fare: 85,
            payment_method: "cash", driver_id: assigned ? "00000000-0000-4000-8000-000000000201" : null,
            start_otp: "1234", end_otp: "5678", start_otp_verified: ["ongoing", "completed"].includes(tripStatus), end_otp_verified: tripStatus === "completed",
            created_at: "2026-10-19T08:00:00.000Z", completed_at: tripStatus === "completed" ? "2026-10-19T08:20:00.000Z" : null,
            ride_type: "now", offer_status: tripStatus === "offered" ? "awaiting_response" : null,
          }, driver: assigned ? {
            id: "00000000-0000-4000-8000-000000000201", first_name: "Preview", last_name: "Driver", phone: "0000000000",
            vehicle_make: "Toyota", vehicle_model: "Corolla", vehicle_color: "Silver", vehicle_registration: "PREVIEW",
            lat: -25.115, lng: 29.05, completed_trips_count: 42, average_rating: 4.9,
          } : null, rating: null, tracking: {
            liveState: tripStatus, driverFresh: assigned, freshnessSeconds: assigned ? 10 : null,
            driverLastSeen: assigned ? "2026-10-19T08:01:00.000Z" : null,
            startOtpVerified: ["ongoing", "completed"].includes(tripStatus), endOtpVerified: tripStatus === "completed",
            scheduledFor: null, scheduledReleaseAt: null,
          } });
        }
        if (url.pathname === "/api/customer/trip-location") return json({ ok: true, location: null, fare: null });
        if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "Unavailable in local visual preview" });
        return route.continue();
      });
      const page = await context.newPage();
      const capture = async (name) => {
        await page.waitForTimeout(450);
        const file = path.join(outputDir, `${name}-${viewport.name}.png`);
        await page.screenshot({ path: file });
        const metrics = await page.evaluate(() => {
          const nav = document.querySelector(".moovu-customer-bottom-nav");
          const navStyle = nav ? getComputedStyle(nav) : null;
          const sheet = document.querySelector(".customer-home-sheet")?.getBoundingClientRect();
          const mapControls = document.querySelector(".customer-map-controls")?.getBoundingClientRect();
          return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            navVisible: navStyle?.opacity !== "0" && navStyle?.pointerEvents !== "none",
            homeControlsOverlap: Boolean(sheet && mapControls && sheet.top < mapControls.bottom && sheet.left < mapControls.right && sheet.right > mapControls.left),
          };
        });
        if (metrics.scrollWidth > metrics.clientWidth) throw new Error(`${name} overflows at ${viewport.name}`);
        if (["01-home", "11-my-trips", "12-account"].includes(name) && !metrics.navVisible) throw new Error(`${name} navigation is hidden at ${viewport.name}`);
        if (name === "01-home" && metrics.homeControlsOverlap) throw new Error(`Home map controls overlap the booking sheet at ${viewport.name}`);
        if (name === "05-confirm-ride") {
          const button = await page.getByRole("button", { name: "Confirm Ride" }).boundingBox();
          if (!button || button.height < 44 || button.y < 0 || button.y + button.height > viewport.height) throw new Error(`Confirm Ride is not fully reachable at ${viewport.name}`);
        }
        console.log(JSON.stringify({ screen: name, viewport: viewport.name, finalPath: new URL(page.url()).pathname, ...metrics }));
      };
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Where are you going?" }).waitFor();
      await capture("01-home");

      await page.goto(`${baseUrl}/book`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Book a ride" }).waitFor();
      await capture("02-pickup-destination");
      await page.locator("#pickup-input").fill("Preview Pickup");
      await page.locator(".moovu-place-option").first().click();
      await page.locator("#dropoff-input").fill("Preview Destination");
      await page.locator(".moovu-place-option").first().click();
      await page.locator(".moovu-ride-option-card").first().waitFor();
      await page.locator(".moovu-ride-option-card").last().click();
      await capture("03-go-and-go-xl");
      await page.getByRole("button", { name: "Pay Online" }).click();
      await capture("04-payment");
      await page.locator(".mbk-confirm-bar button").click();
      await page.getByRole("dialog").waitFor();
      await capture("05-confirm-ride");
      if (process.env.MOOVU_VISUAL_ONLY_BOOKING === "1") {
        await context.close();
        continue;
      }

      for (const [name, status] of [["06-finding-driver", "offered"], ["07-driver-assigned", "assigned"], ["08-driver-arrived", "arrived"], ["09-trip-in-progress", "ongoing"], ["10-trip-completed", "completed"]]) {
        tripStatus = status;
        await page.goto(`${baseUrl}/ride/${tripId}`, { waitUntil: "domcontentloaded" });
        await page.locator(".customer-trip-current-card").waitFor();
        await capture(name);
      }
      for (const [name, pathname, heading] of [["11-my-trips", "/ride/history", "My Trips"], ["12-account", "/account", "Preview Customer"], ["13-help", "/contact", "Help and support"]]) {
        await page.goto(`${baseUrl}${pathname}`, { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: heading }).waitFor();
        await capture(name);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
