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

type PaymentFlagCounts = {
  all: number;
  subscription: number;
  commission: number;
};

type PaymentFlagRow = {
  payment_type?: string | null;
  status?: string | null;
};

type ApplicationFlagRow = {
  id: string;
};

export default function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [paymentFlags, setPaymentFlags] = useState<PaymentFlagCounts>({
    all: 0,
    subscription: 0,
    commission: 0,
  });
  const [pendingApplications, setPendingApplications] = useState(0);

  useEffect(() => {
    let mounted = true;
    let flagsTimer: number | null = null;

    function loadAdminFlags(accessToken: string) {
      fetch("/api/admin/payment-reviews?status=all", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((res) => res.json())
        .then((json: { ok?: boolean; requests?: PaymentFlagRow[] }) => {
          if (!mounted || !json?.ok) return;
          const active = (json.requests ?? []).filter((row) =>
            ["pending_payment_review", "waiting_confirmation"].includes(String(row.status ?? ""))
          );
          setPaymentFlags({
            all: active.length,
            subscription: active.filter((row) => row.payment_type === "subscription").length,
            commission: active.filter((row) => row.payment_type === "commission").length,
          });
        })
        .catch(() => {
          if (mounted) setPaymentFlags({ all: 0, subscription: 0, commission: 0 });
        });

      fetch("/api/admin/driver-applications?status=pending_review", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((res) => res.json())
        .then((json: { ok?: boolean; applications?: ApplicationFlagRow[] }) => {
          if (!mounted || !json?.ok) return;
          setPendingApplications((json.applications ?? []).length);
        })
        .catch(() => {
          if (mounted) setPendingApplications(0);
        });
    }

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

      loadAdminFlags(session.access_token);
      flagsTimer = window.setInterval(() => loadAdminFlags(session.access_token), 30000);

      setChecking(false);
    }

    checkAuth();

    return () => {
      mounted = false;
      if (flagsTimer) window.clearInterval(flagsTimer);
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
                          <span>{item.label}</span>
                          {item.href === "/admin/payment-reviews" && paymentFlags.all > 0 ? (
                            <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-800">
                              {paymentFlags.all}
                            </span>
                          ) : null}
                          {item.href === "/admin/commission-payments" && paymentFlags.commission > 0 ? (
                            <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-800">
                              {paymentFlags.commission}
                            </span>
                          ) : null}
                          {item.href === "/admin/subscriptions" && paymentFlags.subscription > 0 ? (
                            <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-800">
                              {paymentFlags.subscription}
                            </span>
                          ) : null}
                          {item.href === "/admin/applications" && pendingApplications > 0 ? (
                            <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-xs font-black text-red-700">
                              {pendingApplications}
                            </span>
                          ) : null}
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
                <button
                  type="button"
                  onClick={handleLogout}
                  className="moovu-btn moovu-btn-secondary min-h-10 px-4 py-2 text-sm text-red-600"
                >
                  Logout
                </button>
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
                  {item.href === "/admin/applications" && pendingApplications > 0 ? ` (${pendingApplications})` : ""}
                  {item.href === "/admin/payment-reviews" && paymentFlags.all > 0 ? ` (${paymentFlags.all})` : ""}
                  {item.href === "/admin/commission-payments" && paymentFlags.commission > 0 ? ` (${paymentFlags.commission})` : ""}
                  {item.href === "/admin/subscriptions" && paymentFlags.subscription > 0 ? ` (${paymentFlags.subscription})` : ""}
                </Link>
              );
            })}
          </nav>

          <div className="moovu-admin-content p-4 md:p-6">{children}</div>
        </section>
      </div>
    </main>
  );
}
