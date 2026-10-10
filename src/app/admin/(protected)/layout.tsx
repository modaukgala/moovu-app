"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { supabaseClient } from "@/lib/supabase/client";
import AdminTripNotifications from "@/components/AdminTripNotifications";
import EnableNotificationsButton from "@/components/EnableNotificationsButton";
import { LIVE_LOCATION_CONFIG } from "@/lib/location/liveLocationConfig";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import { ADMIN_NAV_GROUPS, ADMIN_NAV_ITEMS, activeAdminNavItem } from "@/lib/admin/navigation";
import { adminPaymentReviewCounts, type AdminPaymentReviewRow } from "@/lib/admin/paymentReviewCounts";

type PaymentFlagCounts = {
  all: number;
  subscription: number;
  commission: number;
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
  const [pendingApplications, setPendingApplications] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstMobileLinkRef = useRef<HTMLAnchorElement>(null);
  const isPageVisible = usePageVisibility();
  const lastPendingApplicationsRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    let flagsTimer: number | null = null;
    let reviewRefresh: (() => void) | null = null;

    function loadAdminFlags(accessToken: string) {
      fetch("/api/admin/payment-reviews?status=all", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((res) => res.json())
        .then((json: { ok?: boolean; requests?: AdminPaymentReviewRow[] }) => {
          if (!mounted || !json?.ok) return;
          setPaymentFlags(adminPaymentReviewCounts(json.requests ?? []));
        })
        .catch(() => {
          if (mounted) setPaymentFlags({ all: 0, subscription: 0, commission: 0 });
        });

      fetch("/api/admin/application-summary", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((res) => res.json())
        .then((json: { ok?: boolean; needsReview?: { count: number } }) => {
          if (!mounted) return;
          if (!json?.ok || !Number.isSafeInteger(json.needsReview?.count)) { setPendingApplications(null); return; }
          const nextCount = json.needsReview!.count;
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
          if (mounted) setPendingApplications(null);
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
      reviewRefresh = () => loadAdminFlags(session.access_token);
      window.addEventListener("moovu-admin:application-review-updated", reviewRefresh);
      window.addEventListener("moovu-admin:payment-review-updated", reviewRefresh);
      flagsTimer = window.setInterval(
        () => {
          if (!document.hidden) loadAdminFlags(session.access_token);
        },
        LIVE_LOCATION_CONFIG.adminFlagsRefreshMs,
      );

      setChecking(false);
    }

    checkAuth();

    return () => {
      mounted = false;
      if (flagsTimer) window.clearInterval(flagsTimer);
      if (reviewRefresh) {
        window.removeEventListener("moovu-admin:application-review-updated", reviewRefresh);
        window.removeEventListener("moovu-admin:payment-review-updated", reviewRefresh);
      }
    };
  }, [pathname]);

  useEffect(() => {
    if (!isPageVisible) return;
    if (pendingApplications !== null) lastPendingApplicationsRef.current = pendingApplications;
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

  const activeItem = activeAdminNavItem(pathname);

  useEffect(() => {
    if (!menuOpen) return;
    firstMobileLinkRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [menuOpen]);

  function renderNavigation(mobile = false) {
    return (
      <nav aria-label="Admin pages" className="moovu-admin-rail">
        {ADMIN_NAV_GROUPS.map(group => (
          <div key={group} className="moovu-admin-nav-group">
            <div className="moovu-admin-nav-heading">{group}</div>
            {ADMIN_NAV_ITEMS.filter(item => item.group === group).map(item => (
              <Link
                key={item.href}
                href={item.href}
                ref={mobile && item.href === "/admin" ? firstMobileLinkRef : undefined}
                onClick={mobile ? () => setMenuOpen(false) : undefined}
                aria-current={activeItem.href === item.href ? "page" : undefined}
                className={`moovu-admin-link ${activeItem.href === item.href ? "moovu-admin-link-active" : ""}`}
              >
                <span>{item.label}</span>
                {item.href === "/admin/payment-reviews" && paymentFlags.all > 0 && <span className="moovu-admin-nav-count">{paymentFlags.all}</span>}
                {item.href === "/admin/commission-payments" && paymentFlags.commission > 0 && <span className="moovu-admin-nav-count">{paymentFlags.commission}</span>}
                {item.href === "/admin/subscriptions" && paymentFlags.subscription > 0 && <span className="moovu-admin-nav-count">{paymentFlags.subscription}</span>}
                {item.href === "/admin/onboarding" && pendingApplications !== null && pendingApplications > 0 && <span className="moovu-admin-nav-count moovu-admin-nav-count-alert">{pendingApplications}</span>}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    );
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

      <div className="moovu-admin-layout">
        <aside className="moovu-admin-sidebar hidden lg:block" aria-label="Admin sidebar">
          <div className="moovu-admin-sidebar-inner">
            <div className="moovu-admin-brand"><span className="moovu-admin-brand-mark">M</span><span><strong>MOOVU</strong><small>Admin workspace</small></span></div>
            {renderNavigation()}
            <button type="button" onClick={handleLogout} className="moovu-admin-link moovu-admin-logout">Logout</button>
          </div>
        </aside>
        {menuOpen && <div className="moovu-admin-mobile-layer lg:hidden">
          <button type="button" className="moovu-admin-backdrop" aria-label="Close Admin navigation" onClick={() => setMenuOpen(false)} />
          <aside id="admin-mobile-navigation" className="moovu-admin-mobile-drawer" role="dialog" aria-modal="true" aria-label="Admin navigation">
            <div className="moovu-admin-mobile-drawer-head"><strong>MOOVU Admin</strong><button type="button" aria-label="Close navigation" onClick={() => { setMenuOpen(false); menuButtonRef.current?.focus(); }}><X size={20} /></button></div>
            {renderNavigation(true)}
            <button type="button" onClick={handleLogout} className="moovu-admin-link moovu-admin-logout">Logout</button>
          </aside>
        </div>}
        <section className="min-w-0">
          <div className="moovu-topbar border-b border-[var(--moovu-border)]">
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button ref={menuButtonRef} type="button" aria-label="Open Admin navigation" aria-controls="admin-mobile-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} className="moovu-admin-menu-button lg:hidden"><Menu size={21} /></button>
                <div className="min-w-0"><div className="moovu-section-title">{activeItem.group}</div><div className="hidden truncate text-sm font-bold text-slate-700 sm:block">Admin workspace</div></div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <EnableNotificationsButton role="admin" variant="inline" />
                <div className="moovu-admin-ops-chip moovu-chip hidden sm:inline-flex">
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

          <div className="moovu-admin-content p-4 md:p-6">{children}</div>
        </section>
      </div>
    </main>
  );
}
