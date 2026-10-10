export type AdminNavItem = {
  href: string;
  label: string;
  group: "Dashboard" | "Trips & Dispatch" | "Drivers & Applications" | "Customers" | "Finance" | "Notifications" | "Archive";
};

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", group: "Dashboard" },
  { href: "/admin/trips", label: "Trips", group: "Trips & Dispatch" },
  { href: "/admin/dispatch", label: "Dispatch Board", group: "Trips & Dispatch" },
  { href: "/admin/dispatch/map", label: "Dispatch Map", group: "Trips & Dispatch" },
  { href: "/admin/receipts", label: "Receipts", group: "Trips & Dispatch" },
  { href: "/admin/drivers", label: "Drivers", group: "Drivers & Applications" },
  { href: "/admin/applications", label: "Legacy Applications", group: "Drivers & Applications" },
  { href: "/admin/onboarding", label: "Onboarding Review", group: "Drivers & Applications" },
  { href: "/admin/link-driver", label: "Link Driver", group: "Drivers & Applications" },
  { href: "/admin/customers", label: "Customers", group: "Customers" },
  { href: "/admin/payment-reviews", label: "Payment Reviews", group: "Finance" },
  { href: "/admin/online-payments", label: "Online Payments", group: "Finance" },
  { href: "/admin/commission-payments", label: "Commissions", group: "Finance" },
  { href: "/admin/settlements", label: "Settlements", group: "Finance" },
  { href: "/admin/earnings", label: "Earnings", group: "Finance" },
  { href: "/admin/reports", label: "Reports", group: "Finance" },
  { href: "/admin/reports/driver-earnings", label: "Driver Earnings Report", group: "Finance" },
  { href: "/admin/moovu-plus", label: "MOOVU+", group: "Finance" },
  { href: "/admin/subscriptions", label: "Subscription History", group: "Finance" },
  { href: "/admin/subscriptions/paid", label: "Past Subscription Payments", group: "Finance" },
  { href: "/admin/notifications", label: "Notifications", group: "Notifications" },
  { href: "/admin/archive", label: "Archive", group: "Archive" },
];

export const ADMIN_NAV_GROUPS = [
  "Dashboard", "Trips & Dispatch", "Drivers & Applications", "Customers", "Finance", "Notifications", "Archive",
] as const;

export function activeAdminNavItem(pathname: string): AdminNavItem {
  const path = pathname.split("?")[0].replace(/\/$/, "") || "/admin";
  const direct = [...ADMIN_NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find(item => path === item.href || path.startsWith(`${item.href}/`));
  if (path.startsWith("/admin/payment-receipts/")) return ADMIN_NAV_ITEMS.find(item => item.href === "/admin/payment-reviews")!;
  return direct ?? ADMIN_NAV_ITEMS[0];
}
