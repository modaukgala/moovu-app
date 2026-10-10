import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(process.cwd(), "src/app/admin/(protected)");

const controls: Record<string, string[]> = {
  "payment-reviews": ["/api/admin/payment-reviews", "reviewRequest(", "View POP", "Open receipt", "payment-review-search"],
  "online-payments": ["/api/admin/online-payments", "changeRange(", "setSelected(row)", "role=\"dialog\""],
  "commission-payments": ["/api/admin/driver-wallet-summary", "reviewRequest(", "openLedger(row)", "commission-driver-search"],
  settlements: ["/api/admin/settlements/record", "recordSettlement", "clearFullBalance", "settlement-reference"],
  earnings: ["/api/admin/earnings", "loadEarnings", "commission_amount", "Driver earnings"],
  reports: ["/api/admin/reports?from", "runReport", "admin-report-from", "completedCommission"],
  "reports/driver-earnings": ["/api/admin/reports/driver-earnings?from", "onClick={load}", "Historical subscription"],
  subscriptions: ["/api/admin/subscriptions/drivers", "/api/admin/subscriptions/history", "legacy-driver-search"],
  "subscriptions/paid": ["/api/admin/payment-reviews?status=all", "View POP", "past-subscription-search"],
  "moovu-plus": ["/api/admin/phase5-memberships", "/api/admin/phase5-credits", "issueCredit()", "reverseCredit(row.id)"],
  trips: ["/api/admin/trips/list", "assignDriver(", "cancelTrip(", "markArrived(", "admin-trip-search"],
  "trips/new": ["/api/admin/trips/create", "createTrip", "calculateDistance", "paymentMethod"],
  "trips/[id]": ["/api/admin/trips/auto-assign", "cancelTrip", "completeTrip", "Phase4FinancePanel"],
  dispatch: ["/api/admin/dispatch/board", "offerNext", "loadBoard", "/admin/dispatch/map"],
  "dispatch/map": ["/api/admin/dispatch/map", "loadBoardMap", "createOrMoveMarker"],
  receipts: ["/api/admin/receipts", "loadReceipts", "admin-receipt-search", "/admin/receipts/${trip.id}"],
  "receipts/[id]": ["/api/admin/receipts/", "window.print()", "moovu-receipt-doc"],
  "payment-receipts/[id]": ["/api/admin/payment-reviews?status=all", "Open proof", "payment.amount_submitted"],
};

test("Group B and C pages retain their existing authority and action entry points", () => {
  for (const [route, markers] of Object.entries(controls)) {
    const source = readFileSync(join(root, route, "page.tsx"), "utf8");
    for (const marker of markers) {
      assert.ok(source.includes(marker), `${route}: missing ${marker}`);
    }
  }
});

test("every Group B and C page has a compact page heading or preserved receipt presentation", () => {
  for (const route of Object.keys(controls)) {
    const source = readFileSync(join(root, route, "page.tsx"), "utf8");
    assert.match(source, /<h1\b|<PageHeader\b/, `${route}: missing page heading`);
    assert.ok(source.includes("moovu-admin-") || source.includes("styles.report"), `${route}: missing shared Admin presentation`);
  }
});
