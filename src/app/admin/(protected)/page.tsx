"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function countValue(value: number | null | undefined) {
  return value == null ? "Unavailable" : String(value);
}

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse["analytics"] | null>(null);
  const [paymentFlags, setPaymentFlags] = useState<PaymentFlags>({
    subscription: 0,
    commission: 0,
    pending: 0,
    waiting: 0,
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

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Link href="/admin/trips?date=today"><MetricCard label="Bookings today" value={countValue(analytics?.today_total_bookings)} helper={`Operational day · ${analytics?.operational_timezone ?? "Africa/Johannesburg"}`} /></Link>
        <Link href="/admin/trips?status=completed&date=today"><MetricCard
          label="Completed today"
          value={countValue(analytics?.today_completed_trips)}
          helper={`Gross ${money(analytics?.today_gross_revenue)}`}
          tone="success"
        /></Link>
        <MetricCard
          label="Commission today"
          value={money(analytics?.today_commission_owed)}
          helper={`Average fare ${money(analytics?.average_fare)}`}
          tone="primary"
        />
        <Link href="/admin/trips?status=cancelled&date=today"><MetricCard
          label="Cancelled today"
          value={countValue(analytics?.today_cancelled_trips)}
          helper={`${Number(analytics?.cancellation_rate ?? 0).toFixed(1)}% cancellation rate`}
          tone={(analytics?.today_cancelled_trips ?? 0) > 0 ? "warning" : "success"}
        /></Link>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link href="/admin/dispatch" className="block"><MetricCard label="Active trips" value={countValue(analytics?.active_trips)} helper="Requested through ongoing" tone="primary" /></Link>
        <Link href="/admin/dispatch" className="block"><MetricCard label="Unassigned trips" value={countValue(analytics?.unassigned_trips)} helper="Requested/offered without driver" tone="warning" /></Link>
        <Link href="/admin/onboarding?status=NEEDS_REVIEW" className="block"><MetricCard label="Pending application reviews" value={countValue(analytics?.pending_driver_applications)} helper="Phase 6 review authority" /></Link>
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Weekly trips" value={String(analytics?.weekly_trips ?? 0)} helper="Completed" />
        <MetricCard label="Monthly trips" value={String(analytics?.monthly_trips ?? 0)} helper="Completed" />
        <MetricCard label="Active drivers" value={String(analytics?.active_drivers ?? 0)} helper="Approved/active" />
        <Link href="/admin/drivers?online=true"><MetricCard label="Online drivers" value={countValue(analytics?.online_drivers)} helper="Presence only" /></Link>
        <MetricCard label="Applications" value={countValue(analytics?.pending_driver_applications)} helper="Pending Phase 6 review" />
        <MetricCard label="Expiring subs" value={String(analytics?.expiring_subscriptions ?? 0)} helper={`${analytics?.active_subscriptions ?? 0} active`} />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link href="/admin/trips?status=scheduled&schedule=next-hour"><MetricCard
          label="Due next hour"
          value={countValue(analytics?.scheduled_due_next_hour)}
          helper="Scheduled trips needing release"
          tone="primary"
        /></Link>
        <Link href="/admin/trips?status=scheduled&schedule=overdue"><MetricCard label="Scheduled overdue" value={countValue(analytics?.scheduled_overdue)} helper="Scheduled time is before now" tone={(analytics?.scheduled_overdue ?? 0) > 0 ? "warning" : "default"} /></Link>
        <Link href="/admin/trips?status=scheduled"><MetricCard
          label="Scheduled pending"
          value={countValue(analytics?.scheduled_total_pending)}
          helper="Future rides in queue"
        /></Link>
        <MetricCard
          label="Open issues"
          value={String(analytics?.open_support_issues ?? 0)}
          helper="Support items needing attention"
          tone={(analytics?.open_support_issues ?? 0) > 0 ? "warning" : "success"}
        />
      </section>

      <ManualSurgeControl />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Link href="/admin/subscriptions" className="moovu-card-interactive p-5">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">
            Subscription POPs
          </div>
          <div className="mt-2 text-3xl font-black text-slate-950">{paymentFlags.subscription ?? "Unavailable"}</div>
          <p className="mt-2 text-sm text-slate-600">Persistent pending subscription reviews.</p>
        </Link>
        <Link href="/admin/commission-payments" className="moovu-card-interactive p-5">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">
            Commission POPs
          </div>
          <div className="mt-2 text-3xl font-black text-slate-950">{paymentFlags.commission ?? "Unavailable"}</div>
          <p className="mt-2 text-sm text-slate-600">Persistent pending commission reviews.</p>
        </Link>
        <Link href="/admin/payment-reviews" className="moovu-card-interactive p-5">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
            Waiting for bank
          </div>
          <div className="mt-2 text-3xl font-black text-slate-950">{paymentFlags.waiting ?? "Unavailable"}</div>
          <p className="mt-2 text-sm text-slate-600">Requests marked waiting for confirmation.</p>
        </Link>
        <div className="moovu-card p-5">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-600">Yoco trip-payment exceptions</div>
          <div className="mt-2 text-xl font-black text-slate-950">{paymentFlags.yocoExceptions ?? "Unsupported"}</div>
          <p className="mt-2 text-sm text-slate-600">This baseline has a verified-payment report, but no supported exception queue.</p>
        </div>
      </section>

      <section className="moovu-admin-command-grid">
        {commandCards.map((item) => (
          <Link key={item.href} href={item.href} className="moovu-admin-command">
            <strong>{item.title}</strong>
            <span>{item.body}</span>
          </Link>
        ))}
      </section>

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
