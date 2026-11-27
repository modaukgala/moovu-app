export type AdminNavItem = {
  href: string;
  label: string;
  group: "Workspace" | "Operations" | "People" | "Money" | "Growth" | "System";
  /** Old-system pages: still reachable by link, but not shown in the menu. */
  hidden?: boolean;
};

// Admin redesign (27 Nov 2026): one clear menu; old-system pages hidden but kept.
export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/admin", label: "Home", group: "Workspace" },
  { href: "/admin/trips", label: "Trips", group: "Operations" },
  { href: "/admin/dispatch", label: "Dispatch board", group: "Operations" },
  { href: "/admin/dispatch/map", label: "Dispatch map", group: "Operations" },
  { href: "/admin/receipts", label: "Trip receipts", group: "Operations" },
  { href: "/admin/customers", label: "Customers", group: "People" },
  { href: "/admin/drivers", label: "Drivers", group: "People" },
  { href: "/admin/onboarding", label: "Driver applications", group: "People" },
  { href: "/admin/link-driver", label: "Link driver account", group: "People", hidden: true },
  { href: "/admin/applications", label: "Old applications", group: "People", hidden: true },
  { href: "/admin/earnings", label: "Money overview", group: "Money" },
  { href: "/admin/online-payments", label: "Card payments", group: "Money" },
  { href: "/admin/online-payouts", label: "Driver payouts", group: "Money" },
  { href: "/admin/refunds", label: "Customer refunds", group: "Money" },
  { href: "/admin/commission-payments", label: "Commission payments", group: "Money" },
  { href: "/admin/reports", label: "Reports", group: "Money" },
  { href: "/admin/business-intelligence", label: "Business insights", group: "Growth" },
  { href: "/admin/business-management", label: "Pricing & settings", group: "Growth" },
  { href: "/admin/moovu-plus", label: "MOOVU+ (paused)", group: "Growth" },
  { href: "/admin/archive", label: "Trip archive", group: "System" },
  { href: "/admin/notifications", label: "Notification check", group: "System" },
  { href: "/admin/storage", label: "Storage & backup", group: "System" },
  { href: "/admin/payment-reviews", label: "Old payment reviews", group: "Money", hidden: true },
  { href: "/admin/subscriptions", label: "Old driver subscriptions", group: "Money", hidden: true },
];

export const ADMIN_NAV_GROUPS = [
  "Workspace", "Operations", "People", "Money", "Growth", "System",
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
