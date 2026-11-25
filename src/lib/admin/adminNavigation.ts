import type { ALLOWED_ADMIN_ROLES } from "@/lib/auth/admin";

type Role = (typeof ALLOWED_ADMIN_ROLES)[number];
const items = [
  ["/admin", "Dashboard", "Workspace"],
  ["/admin/business-management", "Business Management", "Workspace"],
  ["/admin/business-intelligence", "Business Intelligence", "Workspace"],
  ["/admin/trips", "Trips", "Operations"],
  ["/admin/dispatch", "Dispatch Board", "Operations"],
  ["/admin/dispatch/map", "Dispatch Map", "Operations"],
  ["/admin/receipts", "Trip Receipts", "Operations"],
  ["/admin/customers", "Customers", "Operations"],
  ["/admin/drivers", "Drivers", "Operations"],
  ["/admin/applications", "Driver Applications", "Onboarding"],
  ["/admin/onboarding", "Onboarding Review", "Onboarding", true],
  ["/admin/earnings", "Financial Overview", "Finance", true],
  ["/admin/online-payments", "Online Payments", "Finance", true],
  ["/admin/payment-reviews", "Payment Reviews", "Finance", true],
  ["/admin/commission-payments", "Commission Payment Reviews", "Finance", true],
  ["/admin/settlements", "Commission Settlements", "Finance", true],
  ["/admin/reports", "Financial Reports", "Finance", true],
  ["/admin/moovu-plus", "MOOVU+ Memberships", "Memberships and History", true],
  ["/admin/subscriptions", "Historical Driver Subscriptions", "Memberships and History"],
  ["/admin/notifications", "Notification Diagnostics", "System"],
] as const;

export function adminNavigation(role: Role | null) {
  const financial = role === "owner" || role === "admin";
  return items.filter(([, , , restricted]) => !restricted || financial)
    .map(([href, label, group]) => ({ href, label, group }));
}

export function resolveAdminNavigation(path: string, role: Role | null) {
  const pathname = path.replace(/\/$/, "") || "/";
  const contextual: [RegExp, string, string][] = [
    [/^\/admin\/subscriptions\/paid$/, "/admin/subscriptions", "Paid Subscription Proofs"],
    [/^\/admin\/reports\/driver-earnings$/, "/admin/reports", "Driver Earnings Report"],
    [/^\/admin\/payment-receipts\/[^/]+$/, "/admin/payment-reviews", "Payment Receipt"],
    [/^\/admin\/link-driver$/, "/admin/drivers", "Link Driver Account"],
    [/^\/admin\/archive$/, "/admin/trips", "Trip Archive"],
    [/^\/admin\/trips\/new$/, "/admin/trips", "Create Trip"],
    [/^\/admin\/trips\/[^/]+$/, "/admin/trips", "Trip Details"],
    [/^\/admin\/drivers\/new$/, "/admin/drivers", "Create Driver"],
    [/^\/admin\/drivers\/[^/]+\/documents\/(upload|view)$/, "/admin/drivers", "Driver Documents"],
    [/^\/admin\/drivers\/[^/]+$/, "/admin/drivers", "Driver Profile"],
    [/^\/admin\/customers\/[^/]+$/, "/admin/customers", "Customer Profile"],
    [/^\/admin\/receipts\/[^/]+$/, "/admin/receipts", "Trip Receipt"],
  ];
  const links = adminNavigation(role);
  const context = contextual.find(([pattern]) => pattern.test(pathname));
  const selected = context ? links.find(({ href }) => href === context[1]) : links
    .filter(({ href }) => pathname === href || (href !== "/admin" && pathname.startsWith(href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return { href: selected?.href, title: selected ? context?.[2] ?? selected.label : "Admin", group: selected?.group };
}
