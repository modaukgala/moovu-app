import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error Node strip-types tests require the explicit extension.
import { ADMIN_NAV_ITEMS, activeAdminNavItem } from "./navigation.ts";

const pagesRoot = join(process.cwd(), "src/app/admin/(protected)");
function collectPages(dir: string, prefix = "/admin"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectPages(path, `${prefix}/${entry.name}`);
    return entry.name === "page.tsx" ? [prefix] : [];
  });
}

test("every protected Admin page has a sidebar destination or preserved deep-link parent", () => {
  const pages = collectPages(pagesRoot).filter(path => path !== "/admin/logout");
  assert.equal(pages.length, 31);
  const destinations = new Set(ADMIN_NAV_ITEMS.map(item => item.href));
  for (const page of pages) {
    const concretePath = page.replace(/\[id\]/g, "fixture-id");
    const item = activeAdminNavItem(concretePath);
    assert.ok(destinations.has(item.href), `${page} has no destination`);
    assert.ok(item.href !== "/admin" || page === "/admin", `${page} fell back to Dashboard`);
  }
  for (const item of ADMIN_NAV_ITEMS) {
    assert.ok(pages.includes(item.href), `${item.href} has no page`);
  }
});

test("specific routes win over their parent and Group A destinations remain distinct", () => {
  assert.equal(activeAdminNavItem("/admin/dispatch/map").href, "/admin/dispatch/map");
  assert.equal(activeAdminNavItem("/admin/subscriptions/paid").href, "/admin/subscriptions/paid");
  assert.equal(activeAdminNavItem("/admin/reports/driver-earnings").href, "/admin/reports/driver-earnings");
  assert.equal(activeAdminNavItem("/admin/onboarding").href, "/admin/onboarding");
  assert.equal(activeAdminNavItem("/admin/applications").href, "/admin/applications");
  assert.equal(activeAdminNavItem("/admin/drivers/fixture-id").href, "/admin/drivers");
  assert.equal(activeAdminNavItem("/admin/payment-receipts/fixture-id").href, "/admin/payment-reviews");
});

test("layout keeps notification, payment, application and logout controls", () => {
  const source = readFileSync(join(pagesRoot, "layout.tsx"), "utf8");
  for (const marker of ["AdminTripNotifications", "EnableNotificationsButton", "/api/admin/payment-reviews", "/api/admin/application-summary", "handleLogout"]) {
    assert.ok(source.includes(marker), `${marker} missing`);
  }
});

test("presentation changes retain the primary Group A, finance and dispatch actions", () => {
  const controls: Record<string, string[]> = {
    "page.tsx": ["loadAnalytics", "/admin/onboarding", "/admin/trips"],
    "drivers/page.tsx": ["loadDrivers", "/admin/drivers/new"],
    "drivers/[id]/page.tsx": ["setActiveTab", "/admin/onboarding"],
    "applications/page.tsx": ["loadApplications", "/admin/onboarding"],
    "onboarding/page.tsx": ["load(detail?.application.id)", "decision(\"APPROVED\"", "decision(\"REJECTED\""],
    "trips/page.tsx": ["refreshTrips", "/admin/trips/new"],
    "dispatch/page.tsx": ["loadBoard", "/admin/dispatch/map"],
    "dispatch/map/page.tsx": ["loadBoardMap"],
    "earnings/page.tsx": ["/api/admin/earnings", "commission_amount", "driver_net_earnings"],
  };
  for (const [page, markers] of Object.entries(controls)) {
    const source = readFileSync(join(pagesRoot, page), "utf8");
    for (const marker of markers) assert.ok(source.includes(marker), `${page}: ${marker} missing`);
  }
});
