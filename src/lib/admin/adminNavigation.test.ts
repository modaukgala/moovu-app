import assert from "node:assert/strict";
import test from "node:test";

const { adminNavigation, resolveAdminNavigation } = await import(
  new URL("./adminNavigation.ts", import.meta.url).href
) as typeof import("./adminNavigation");

test("Admin destinations resolve one contextual parent with path boundaries", () => {
  for (const [path, parent, title] of [
    ["/admin", "/admin", "Dashboard"],
    ["/admin/dispatch", "/admin/dispatch", "Dispatch Board"],
    ["/admin/dispatch/map", "/admin/dispatch/map", "Dispatch Map"],
    ["/admin/trips/new", "/admin/trips", "Create Trip"],
    ["/admin/customers/customer", "/admin/customers", "Customer Profile"],
    ["/admin/drivers/driver/documents/view", "/admin/drivers", "Driver Documents"],
    ["/admin/subscriptions/paid", "/admin/subscriptions", "Paid Subscription Proofs"],
    ["/admin/reports/driver-earnings", "/admin/reports", "Driver Earnings Report"],
    ["/admin/payment-receipts/receipt", "/admin/payment-reviews", "Payment Receipt"],
  ]) {
    const result = resolveAdminNavigation(path, "admin");
    assert.equal(result.href, parent);
    assert.equal(result.title, title);
  }
  assert.equal(resolveAdminNavigation("/admin/trips-extra", "admin").href, undefined);
});
test("restricted links are excluded for unresolved and operational roles", () => {
  for (const role of [null, "dispatcher", "support", "admin", "owner"] as const) {
    const links: string[] = adminNavigation(role).map(({ href }) => href);
    const reviewer = role === "owner" || role === "admin";
    assert.equal(links.includes("/admin/online-payments"), reviewer);
    assert.equal(links.includes("/admin/onboarding"), reviewer);
    assert.equal(links.includes("/admin/payment-reviews"), reviewer);
    assert.ok(links.includes("/admin/subscriptions"));
    assert.ok(links.includes("/admin/drivers"));
    assert.equal(links.includes("/admin/link-driver"), false);
    assert.equal(links.includes("/admin/subscriptions/paid"), false);
  }
});
