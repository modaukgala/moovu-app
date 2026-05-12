"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import AdminTripNotifications from "@/components/AdminTripNotifications";
import EnableNotificationsButton from "@/components/EnableNotificationsButton";

const navItems = [
  { href: "/admin", label: "Dashboard", group: "Operations" },
  { href: "/admin/trips", label: "Trips", group: "Operations" },
  { href: "/admin/dispatch/map", label: "Dispatch Map", group: "Operations" },
  { href: "/admin/receipts", label: "Receipts", group: "Operations" },
  { href: "/admin/drivers", label: "Drivers", group: "Drivers" },
  { href: "/admin/applications", label: "Applications", group: "Drivers" },
  { href: "/admin/link-driver", label: "Link Driver", group: "Drivers" },
  { href: "/admin/payment-reviews", label: "Payments", group: "Payments" },
  { href: "/admin/commission-payments", label: "Commissions", group: "Payments" },
  { href: "/admin/subscriptions", label: "Subscriptions", group: "Payments" },
  { href: "/admin/settlements", label: "Settlements", group: "Payments" },
  { href: "/admin/reports", label: "Earnings Report", group: "Reports" },
  { href: "/admin/earnings", label: "Earnings Dashboard", group: "Reports" },
  { href: "/admin/notifications", label: "Notifications", group: "System" },
];

export default function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!mounted) return;

      if (!session) {
        const host =
          typeof window !== "undefined" ? window.location.host.toLowerCase() : "";
        const isAdminHost =
          host === "admin.moovurides.co.za" ||
          host.startsWith("admin.localhost") ||
          host.startsWith("admin.127.0.0.1");

        const next = pathname || "/admin";

        if (isAdminHost) {
          window.location.href = `/login?next=${encodeURIComponent(next)}`;
        } else {
          window.location.href = `/admin/login?next=${encodeURIComponent(next)}`;
        }
        return;
      }

      setChecking(false);
    }

    checkAuth();

    return () => {
      mounted = false;
    };
  }, [pathname]);

  async function handleLogout() {
    await supabaseClient.auth.signOut();

    const host =
      typeof window !== "undefined" ? window.location.host.toLowerCase() : "";
    const isAdminHost =
      host === "admin.moovurides.co.za" ||
      host.startsWith("admin.localhost") ||
      host.startsWith("admin.127.0.0.1");

    if (isAdminHost) {
      window.location.href = "/login";
    } else {
      window.location.href = "/admin/login";
    }
  }

  const activeLabel = useMemo(() => {
    const current = navItems.find((item) =>
      item.href === "/admin"
        ? pathname === "/admin"
        : pathname === item.href || pathname.startsWith(`${item.href}/`)
    );
    return current?.label || "Admin";
  }, [pathname]);

  const groupedNavItems = useMemo(() => {
    return navItems.reduce<Record<string, typeof navItems>>((groups, item) => {
      groups[item.group] = groups[item.group] ?? [];
      groups[item.group].push(item);
      return groups;
    }, {});
  }, []);

  if (checking) {
    return (
      <main className="moovu-auth-shell text-black">
        <div className="moovu-auth-card text-center">
          <div className="moovu-chip mx-auto w-fit">
            <span className="moovu-chip-dot" />
            MOOVU Admin
          </div>
          <h1 className="mt-4 text-2xl font-black text-slate-950">
            Checking admin access...
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            Verifying your session before loading the control center.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="moovu-admin-shell text-black">
      <AdminTripNotifications />

      <div className="grid min-h-screen lg:grid-cols-[300px_1fr]">
        <aside className="moovu-admin-sidebar hidden px-5 py-6 lg:block">
          <div className="sticky top-5 space-y-6">
            <div className="moovu-hero-panel p-5">
              <div className="moovu-chip w-fit">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--moovu-primary)]" />
                MOOVU Admin
              </div>

              <h1 className="mt-4 text-2xl font-black text-white">
                Control center
              </h1>

              <p className="mt-2 text-sm leading-6 text-white/76">
                Manage operations, dispatch, subscriptions and trip movement from one place.
              </p>
            </div>

            <nav className="rounded-[28px] border border-[var(--moovu-border)] bg-white p-3 shadow-sm">
              <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Navigation
              </div>

              <div className="moovu-admin-rail">
                {Object.entries(groupedNavItems).map(([group, items]) => (
                  <div key={group} className="space-y-1">
                    <div className="px-3 pb-1 pt-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
                      {group}
                    </div>
                    {items.map((item) => {
                      const active =
                        item.href === "/admin"
                          ? pathname === "/admin"
                          : pathname === item.href || pathname.startsWith(`${item.href}/`);

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`moovu-admin-link ${
                            active ? "moovu-admin-link-active" : ""
                          }`}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                ))}

                <button
                  onClick={handleLogout}
                  className="moovu-admin-link mt-2 w-full text-left text-red-600 hover:border-red-100 hover:bg-red-50"
                >
                  Logout
                </button>
              </div>
            </nav>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="moovu-topbar border-b border-[var(--moovu-border)]">
            <div className="flex items-center justify-between gap-4 px-5 py-4 md:px-7">
              <div>
                <div className="moovu-section-title">Operations</div>
                <div className="mt-2 text-2xl font-semibold text-slate-950">
                  {activeLabel}
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                <EnableNotificationsButton role="admin" variant="inline" />
                <div className="moovu-chip">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  Ops live
                </div>
              </div>
            </div>
          </div>

          <nav className="moovu-admin-mobile-nav lg:hidden">
            {navItems.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? "is-active" : ""}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="p-4 md:p-6">{children}</div>
        </section>
      </div>
    </main>
  );
}
