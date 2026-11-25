"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import AdminTripNotifications from "@/components/AdminTripNotifications";
import EnableNotificationsButton from "@/components/EnableNotificationsButton";
import { LIVE_LOCATION_CONFIG } from "@/lib/location/liveLocationConfig";
import { usePageVisibility } from "@/hooks/usePageVisibility";

import { AdminRoleContext } from "@/lib/admin/adminRoleContext";
import { adminNavigation, resolveAdminNavigation } from "@/lib/admin/adminNavigation";

type Role = Parameters<typeof adminNavigation>[0];

type PaymentFlagCounts = {
  all: number | null;
  subscription: number | null;
  commission: number | null;
};

export default function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [role, setRole] = useState<Role>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [roleFailed, setRoleFailed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [paymentFlags, setPaymentFlags] = useState<PaymentFlagCounts>({
    all: 0,
    subscription: 0,
    commission: 0,
  });
  const [pendingApplications, setPendingApplications] = useState<number | null>(null);
  const isPageVisible = usePageVisibility();
  const lastPendingApplicationsRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    let flagsTimer: number | null = null;
    let flagsController: AbortController | null = null;

    function loadAdminFlags(accessToken: string) {
      flagsController?.abort();
      flagsController = new AbortController();
      const controller = flagsController;
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      fetch("/api/admin/operational-counts", {
        cache: "no-store",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then(async (res) => ({ res, json: await res.json().catch(() => null) }))
        .then(({ res, json }) => {
          if (!mounted || controller !== flagsController) return;
          if (!res.ok || !json?.ok) throw new Error("Operational counts unavailable");
          const nextRole = json.role;
          if (!["owner", "admin", "dispatcher", "support"].includes(nextRole)) throw new Error("Admin role unavailable");
          setRole(nextRole);
          setRoleFailed(false);
          const queues = json.paymentQueues as { pendingProofs: number; awaitingConfirmation: number; subscriptionProofs: number; commissionProofs: number } | null;
          setPaymentFlags({
            all: queues ? queues.pendingProofs : null,
            subscription: queues?.subscriptionProofs ?? null,
            commission: queues?.commissionProofs ?? null,
          });
          const nextCount = json.pendingApplicationReviews as number | null;
          if (nextCount == null) { setPendingApplications(null); return; }
          if (nextCount > lastPendingApplicationsRef.current) {
            window.dispatchEvent(new CustomEvent("moovu-admin:new-applications", {
              detail: {
                count: nextCount - lastPendingApplicationsRef.current,
                total: nextCount,
              },
            }));
          }
          lastPendingApplicationsRef.current = nextCount;
          setPendingApplications(nextCount);
        })
        .catch(() => {
          if (mounted && controller === flagsController) {
            setRole(null);
            setRoleFailed(true);
            setPaymentFlags({ all: null, subscription: null, commission: null });
            setPendingApplications(null);
          }
        })
        .finally(() => window.clearTimeout(timeout));
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
      flagsTimer = window.setInterval(
        () => {
          if (!document.hidden) loadAdminFlags(session.access_token);
        },
        LIVE_LOCATION_CONFIG.adminFlagsRefreshMs,
      );

      setChecking(false);
    }

    void checkAuth().catch(() => {
      if (mounted) { setChecking(false); setRoleFailed(true); }
    });
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event) => {
      if (["SIGNED_OUT", "SIGNED_IN", "USER_UPDATED", "TOKEN_REFRESHED"].includes(event)) {
        flagsController?.abort();
        flagsController = null;
        setRole(null);
        setPaymentFlags({ all: null, subscription: null, commission: null });
        setPendingApplications(null);
        setSessionKey((key) => key + 1);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      flagsController?.abort();
      if (flagsTimer) window.clearInterval(flagsTimer);
    };
  }, [pathname, sessionKey]);

  useEffect(() => {
    if (!isPageVisible) return;
    if (pendingApplications != null) lastPendingApplicationsRef.current = pendingApplications;
  }, [isPageVisible, pendingApplications]);

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

  const active = resolveAdminNavigation(pathname, role);
  const groupedNavItems = useMemo(() => {
    const links = adminNavigation(role);
    return links.reduce<Record<string, typeof links>>((groups, item) => {
      (groups[item.group] ??= []).push(item);
      return groups;
    }, {});
  }, [role]);
  const financial = role === "owner" || role === "admin";
  function navigation() {
    return Object.entries(groupedNavItems).map(([group, items]) => (
      <div key={group} className="space-y-1">
        <div className="px-3 pb-1 pt-3 text-xs font-semibold text-slate-600">{group}</div>
        {items.map(({ href, label }) => {
          const count = !financial ? null : href === "/admin/onboarding" ? pendingApplications :
            href === "/admin/payment-reviews" ? paymentFlags.all :
            href === "/admin/commission-payments" ? paymentFlags.commission :
            href === "/admin/subscriptions" ? paymentFlags.subscription : null;
          return <Link key={href} href={href}
            className={`moovu-admin-link ${active.href === href ? "moovu-admin-link-active" : ""}`}
            aria-current={active.href === href ? pathname === href ? "page" : "location" : undefined}>
            <span>{label}</span>{count != null && count > 0 && <span className="rounded-full bg-amber-100 px-2 text-xs text-amber-900">{count}</span>}
          </Link>;
        })}
      </div>
    ));
  }

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
                {navigation()}

                <button
                  onClick={handleLogout}
                  className="moovu-admin-link mt-2 w-full text-left text-red-600 hover:border-red-100 hover:bg-red-50"
                >
                  Sign out
                </button>
              </div>
            </nav>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="moovu-topbar border-b border-[var(--moovu-border)]">
            <div className="flex items-center justify-between gap-4 px-5 py-4 md:px-7">
              <div>
                <div className="moovu-section-title">{active.group ?? "Workspace"}</div>
                <div className="mt-2 text-2xl font-semibold text-slate-950">
                  {active.title}
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
                  Sign out
                </button>
              </div>
            </div>
          </div>

          <details className="border-b bg-white px-4 py-3 lg:hidden" key={pathname}>
            <summary className="cursor-pointer py-2 font-semibold">Admin navigation</summary>
            <nav aria-label="Mobile Admin navigation" className="pb-2">{navigation()}</nav>
          </details>
          {role === null && <p role="status" className="px-5 pt-3 text-sm">
            {roleFailed ? <>Admin access details unavailable. <button className="underline" onClick={() => setSessionKey((key) => key + 1)}>Retry access check</button></> : "Checking Admin access details…"}
          </p>}

          <div className="moovu-admin-content p-4 md:p-6"><AdminRoleContext.Provider value={role}>{children}</AdminRoleContext.Provider></div>
        </section>
      </div>
    </main>
  );
}
