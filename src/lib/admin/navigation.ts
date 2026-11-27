export type AdminNavItem = {
  href: string;
  label: string;
  group: "Workspace" | "Operations" | "Drivers & Onboarding" | "Finance" | "Memberships & History" | "System";
};

// Admin 2.0 phase 4 grouping (adapted to the live pages).
export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", group: "Workspace" },
  { href: "/admin/business-intelligence", label: "Business Intelligence", group: "Workspace" },
  { href: "/admin/business-management", label: "Business Management", group: "Workspace" },
  { href: "/admin/trips", label: "Trips", group: "Operations" },
  { href: "/admin/dispatch", label: "Dispatch Board", group: "Operations" },
  { href: "/admin/dispatch/map", label: "Dispatch Map", group: "Operations" },
  { href: "/admin/receipts", label: "Trip Receipts", group: "Operations" },
  { href: "/admin/customers", label: "Customers", group: "Operations" },
  { href: "/admin/drivers", label: "Drivers", group: "Drivers & Onboarding" },
  { href: "/admin/onboarding", label: "Onboarding Review", group: "Drivers & Onboarding" },
  { href: "/admin/applications", label: "Legacy Applications", group: "Drivers & Onboarding" },
  { href: "/admin/link-driver", label: "Link Driver", group: "Drivers & Onboarding" },
  { href: "/admin/earnings", label: "Financial Overview", group: "Finance" },
  { href: "/admin/online-payments", label: "Online Payments", group: "Finance" },
  { href: "/admin/online-payouts", label: "Driver Payouts", group: "Finance" },
  { href: "/admin/refunds", label: "Customer Refunds", group: "Finance" },
  { href: "/admin/payment-reviews", label: "Payment Reviews", group: "Finance" },
  { href: "/admin/commission-payments", label: "Commission Payment Reviews", group: "Finance" },
  { href: "/admin/reports", label: "Financial Reports", group: "Finance" },
  { href: "/admin/moovu-plus", label: "MOOVU+ Memberships", group: "Memberships & History" },
  { href: "/admin/subscriptions", label: "Historical Driver Subscriptions", group: "Memberships & History" },
  { href: "/admin/archive", label: "Trip Archive", group: "Memberships & History" },
  { href: "/admin/notifications", label: "Notification Diagnostics", group: "System" },
  { href: "/admin/storage", label: "Storage & backup", group: "System" },
];

export const ADMIN_NAV_GROUPS = [
  "Workspace", "Operations", "Drivers & Onboarding", "Finance", "Memberships & History", "System",
] as const;

export function activeAdminNavItem(pathname: string): AdminNavItem {
  const path = pathname.split("?")[0].replace(/\/$/, "") || "/admin";
  if (path === "/admin/settlements") return ADMIN_NAV_ITEMS.find(item => item.href === "/admin/commission-payments")!;
  const direct = [...ADMIN_NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find(item => path === item.href || path.startsWith(`${item.href}/`));
  if (path.startsWith("/admin/payment-receipts/")) return ADMIN_NAV_ITEMS.find(item => item.href === "/admin/payment-reviews")!;
  return direct ?? ADMIN_NAV_ITEMS[0];
}
