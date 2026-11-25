"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { countValue, dashboardOperationalCards, dashboardQueueCards } from "@/lib/admin/dashboardCards";
import { AdminRoleContext } from "@/lib/admin/adminRoleContext";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import MetricCard from "@/components/ui/MetricCard";
import ManualSurgeControl from "@/components/admin/ManualSurgeControl";
import { supabaseClient } from "@/lib/supabase/client";

type AnalyticsResponse = {
  ok: boolean;
  analytics?: {
    today_total_bookings: number | null;
    today_completed_trips: number | null;
    today_cancelled_trips: number | null;
    active_trips: number | null;
    unassigned_trips: number | null;
    today_gross_revenue: number | null;
    today_commission_owed: number | null;
    weekly_trips: number;
    monthly_trips: number;
    active_drivers: number;
    online_drivers: number | null;
    pending_driver_applications: number | null;
    active_subscriptions: number;
    expiring_subscriptions: number;
    average_fare: number;
    cancellation_rate: number;
    scheduled_due_next_hour: number | null;
    scheduled_overdue: number | null;
    scheduled_total_pending: number | null;
    operational_timezone: string;
    open_support_issues: number;
    low_rated_drivers: Array<{
      driver_id: string;
      driver_name: string;
      avg_rating: number;
      total_ratings: number;
      total_issues: number;
      quality_score: number;
    }>;
    recent_cancellations: Array<{
      id: string;
      rider_name?: string | null;
      cancelled_by: string | null;
      cancellation_fee_amount: number | null;
      created_at: string | null;
    }>;
    top_drivers: Array<{
      driver_id: string;
      driver_name: string;
      avg_rating: number;
      total_ratings: number;
      total_completed_trips: number;
      quality_score: number;
    }>;
    generated_at: string;
  };
  error?: string;
};

type PaymentFlags = {
  subscription: number | null;
  commission: number | null;
  pending: number | null;
  waiting: number | null;
  yocoExceptions: number | null;
};

function money(value: number | null | undefined) {
  return value == null ? "Unavailable" : `R${Number(value).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

export default function AdminDashboardPage() {
  const role = useContext(AdminRoleContext);
  const financial = role === "owner" || role === "admin";
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse["analytics"] | null>(null);
  const [paymentFlags, setPaymentFlags] = useState<PaymentFlags>({
    subscription: null,
    commission: null,
    pending: null,
    waiting: null,
    yocoExceptions: null,
  });

  async function loadAnalytics() {
    setLoading(true);
    setMsg(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) throw new Error("You are not logged in.");
      const res = await fetch("/api/admin/analytics", { cache: "no-store", signal: controller.signal, headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await res.json().catch(() => null) as AnalyticsResponse | null;
      if (!res.ok || !json?.ok || !json.analytics) throw new Error(json?.error || "Failed to load analytics.");
      setAnalytics(json.analytics);
    } catch (error) {
      setAnalytics(null);
      setMsg(error instanceof DOMException && error.name === "AbortError" ? "Dashboard request timed out. Please retry." : error instanceof Error ? error.message : "Failed to load analytics.");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function loadPaymentFlags() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) return;

    const res = await fetch("/api/admin/operational-counts", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;

    if (!res?.ok || !json?.ok) {
      setPaymentFlags({ subscription: null, commission: null, pending: null, waiting: null, yocoExceptions: null });
      return;
    }
    const queues = json.paymentQueues as { pendingProofs: number; awaitingConfirmation: number; subscriptionProofs: number; commissionProofs: number } | null;
    setPaymentFlags({
      subscription: queues?.subscriptionProofs ?? null,
      commission: queues?.commissionProofs ?? null,
      pending: queues?.pendingProofs ?? null,
      waiting: queues?.awaitingConfirmation ?? null,
      yocoExceptions: json.yocoTripPaymentExceptions ?? null,
    });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAnalytics();
      void loadPaymentFlags();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const commandCards = useMemo(
    () => [
      {
        href: "/admin/dispatch",
        title: "Dispatch board",
        body: "Offer trips, watch rollovers, and keep active movement visible.",
      },
      {
        href: "/admin/dispatch/map",
        title: "Live map",
        body: "See drivers, active pickup points, and coverage movement.",
      },
      {
        href: "/admin/payment-reviews",
        title: "Payment queue",
        body: "Review subscriptions, commissions, combined payments, and POP files.",
      },
      {
        href: "/admin/receipts",
        title: "Receipts",
        body: "Open completed and cancelled trip receipts without losing context.",
      },
    ],
    [],
  );

  if (loading) {
    return (
      <main className="space-y-5">
        <div className="moovu-hero-panel p-6">
          <div className="moovu-section-title text-white/70">MOOVU Admin</div>
          <div className="mt-4 space-y-3">
            <div className="moovu-skeleton h-7 w-64" />
            <div className="grid gap-3 md:grid-cols-3">
              <div className="moovu-skeleton h-28 w-full" />
              <div className="moovu-skeleton h-28 w-full" />
              <div className="moovu-skeleton h-28 w-full" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <section className="moovu-hero-panel p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-white/70">
              Live operations
            </div>
            <h1 className="mt-3 max-w-3xl text-3xl font-black tracking-tight text-white sm:text-5xl">
              Command trips, drivers, payments, and receipts from one control room.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/74">
              Built for fast scanning: urgent trips first, payment work visible, and driver quality signals close to dispatch.
            </p>
          </div>

          <button onClick={() => void loadAnalytics()} className="moovu-btn bg-white text-slate-950">
            Refresh dashboard
          </button>
        </div>
      </section>

      <h2 className="text-xl font-semibold">Requires attention</h2>
      {financial && <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {dashboardQueueCards(financial, { ...paymentFlags, applications: analytics?.pending_driver_applications }).map(card => (
          <Link key={card.field} href={card.href}><MetricCard label={card.label} value={card.value} /></Link>
        ))}
      </section>}
      <h2 className="text-xl font-semibold">Live operations</h2>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Link href={dashboardOperationalCards.today_total_bookings.href}><MetricCard label={dashboardOperationalCards.today_total_bookings.label} value={countValue(analytics?.today_total_bookings)} helper={`Operational day · ${analytics?.operational_timezone ?? "Africa/Johannesburg"}`} /></Link>
        <Link href={dashboardOperationalCards.today_completed_trips.href}><MetricCard
          label={dashboardOperationalCards.today_completed_trips.label}
          value={countValue(analytics?.today_completed_trips)}
          helper={financial ? `Gross ${money(analytics?.today_gross_revenue)}` : undefined}
          tone="success"
        /></Link>
        {financial && <MetricCard
          label="Commission today"
          value={money(analytics?.today_commission_owed)}
          helper={`Average fare ${money(analytics?.average_fare)}`}
          tone="primary"
        />}
        <Link href={dashboardOperationalCards.today_cancelled_trips.href}><MetricCard
          label={dashboardOperationalCards.today_cancelled_trips.label}
          value={countValue(analytics?.today_cancelled_trips)}
          helper={analytics?.cancellation_rate == null ? "Cancellation rate unavailable" : `${analytics.cancellation_rate.toFixed(1)}% cancellation rate`}
          tone={(analytics?.today_cancelled_trips ?? 0) > 0 ? "warning" : "success"}
        /></Link>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link href={dashboardOperationalCards.active_trips.href} className="block"><MetricCard label={dashboardOperationalCards.active_trips.label} value={countValue(analytics?.active_trips)} helper="Requested through ongoing" tone="primary" /></Link>
        <Link href={dashboardOperationalCards.unassigned_trips.href} className="block"><MetricCard label={dashboardOperationalCards.unassigned_trips.label} value={countValue(analytics?.unassigned_trips)} helper="Requested/offered without driver" tone="warning" /></Link>

      </section>

      <h2 className="text-xl font-semibold">Operational shortcuts</h2>
      <section className="moovu-admin-command-grid">
        {commandCards.filter((item) => financial || item.href !== "/admin/payment-reviews").map((item) => (
          <Link key={item.href} href={item.href} className="moovu-admin-command">
            <strong>{item.title}</strong>
            <span>{item.body}</span>
          </Link>
        ))}
      </section>
      <h2 className="text-xl font-semibold">Business overview</h2>
      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Weekly trips" value={countValue(analytics?.weekly_trips)} helper="Completed" />
        <MetricCard label="Monthly trips" value={countValue(analytics?.monthly_trips)} helper="Completed" />
        <MetricCard label="Active drivers" value={countValue(analytics?.active_drivers)} helper="Approved/active" />
        <Link href={dashboardOperationalCards.online_drivers.href}><MetricCard label={dashboardOperationalCards.online_drivers.label} value={countValue(analytics?.online_drivers)} helper="Presence only" /></Link>
        <MetricCard label="Expiring historical subscriptions" value={countValue(analytics?.expiring_subscriptions)} helper={`${countValue(analytics?.active_subscriptions)} active`} />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link href={dashboardOperationalCards.scheduled_due_next_hour.href}><MetricCard
          label={dashboardOperationalCards.scheduled_due_next_hour.label}
          value={countValue(analytics?.scheduled_due_next_hour)}
          helper="Scheduled trips needing release"
          tone="primary"
        /></Link>
        <Link href={dashboardOperationalCards.scheduled_overdue.href}><MetricCard label={dashboardOperationalCards.scheduled_overdue.label} value={countValue(analytics?.scheduled_overdue)} helper="Scheduled time is before now" tone={(analytics?.scheduled_overdue ?? 0) > 0 ? "warning" : "default"} /></Link>
        <Link href={dashboardOperationalCards.scheduled_total_pending.href}><MetricCard
          label={dashboardOperationalCards.scheduled_total_pending.label}
          value={countValue(analytics?.scheduled_total_pending)}
          helper="Future rides in queue"
        /></Link>
        <MetricCard
          label="Open issues"
          value={countValue(analytics?.open_support_issues)}
          helper="Support items needing attention"
          tone={(analytics?.open_support_issues ?? 0) > 0 ? "warning" : "success"}
        />
      </section>

      <ManualSurgeControl />





      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="moovu-card-interactive p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="moovu-section-title">Driver performance</div>
              <h2 className="mt-2 text-2xl font-black text-slate-950">Top drivers</h2>
            </div>
            <Link href="/admin/drivers" className="moovu-btn moovu-btn-secondary">
              Open drivers
            </Link>
          </div>

          {(analytics?.top_drivers?.length ?? 0) === 0 ? (
            <div className="mt-5 rounded-3xl bg-slate-50 p-5 text-sm text-slate-600">
              No quality metrics available yet.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {analytics!.top_drivers.map((driver, index) => (
                <article
                  key={driver.driver_id}
                  className="rounded-3xl border border-[var(--moovu-border)] bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--moovu-primary-soft)] text-sm font-black text-[var(--moovu-primary)]">
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-black text-slate-950">{driver.driver_name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {driver.total_completed_trips} completed trips
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-right text-sm">
                      <div>
                        <div className="text-xs text-slate-500">Rating</div>
                        <div className="font-black">{Number(driver.avg_rating).toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Rated</div>
                        <div className="font-black">{driver.total_ratings}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Quality</div>
                        <div className="font-black">{Number(driver.quality_score).toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <section className="moovu-card-interactive p-5 sm:p-6">
            <div className="moovu-section-title">Quality watchlist</div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Drivers needing attention</h2>

            {(analytics?.low_rated_drivers?.length ?? 0) === 0 ? (
              <div className="mt-5 rounded-3xl bg-emerald-50 p-5 text-sm font-medium text-emerald-800">
                No low-rated drivers currently flagged.
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {analytics!.low_rated_drivers.map((driver) => (
                  <article key={driver.driver_id} className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
                    <div className="font-black text-slate-950">{driver.driver_name}</div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-amber-800">Rating</div>
                        <div className="font-black">{Number(driver.avg_rating).toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-amber-800">Issues</div>
                        <div className="font-black">{driver.total_issues}</div>
                      </div>
                      <div>
                        <div className="text-xs text-amber-800">Quality</div>
                        <div className="font-black">{Number(driver.quality_score).toFixed(2)}</div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="moovu-card-interactive p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="moovu-section-title">Recent movement</div>
                <h2 className="mt-2 text-2xl font-black text-slate-950">Cancellations</h2>
              </div>
              <Link href="/admin/trips" className="moovu-btn moovu-btn-secondary">
                Open trips
              </Link>
            </div>

            {(analytics?.recent_cancellations?.length ?? 0) === 0 ? (
              <div className="mt-5 rounded-3xl bg-slate-50 p-5 text-sm text-slate-600">
                No recent cancellations found.
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {analytics!.recent_cancellations.map((item) => (
                  <article key={item.id} className="rounded-3xl border border-[var(--moovu-border)] bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-slate-950">
                          {item.rider_name || "Unknown rider"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{displayDate(item.created_at)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Fee</div>
                        <div className="font-black text-slate-950">{money(item.cancellation_fee_amount)}</div>
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-slate-500">
                      Cancelled by {item.cancelled_by || "--"} · Trip {item.id.slice(0, 8)}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
