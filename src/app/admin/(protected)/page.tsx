"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import MetricCard from "@/components/ui/MetricCard";
import { supabaseClient } from "@/lib/supabase/client";

type AnalyticsResponse = {
  ok: boolean;
  analytics?: {
    scheduled_due_next_hour: number;
    scheduled_total_pending: number;
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

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse["analytics"] | null>(null);

  async function loadAnalytics() {
    setLoading(true);
    setMsg(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      setMsg("You are not logged in.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/admin/analytics", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const json = (await res.json()) as AnalyticsResponse;

    if (!json?.ok || !json.analytics) {
      setMsg(json?.error || "Failed to load analytics.");
      setLoading(false);
      return;
    }

    setAnalytics(json.analytics);
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAnalytics();
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

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label="Due next hour"
          value={String(analytics?.scheduled_due_next_hour ?? 0)}
          helper="Scheduled trips needing release"
          tone="primary"
        />
        <MetricCard
          label="Scheduled pending"
          value={String(analytics?.scheduled_total_pending ?? 0)}
          helper="Future rides in queue"
        />
        <MetricCard
          label="Open issues"
          value={String(analytics?.open_support_issues ?? 0)}
          helper="Support items needing attention"
          tone={(analytics?.open_support_issues ?? 0) > 0 ? "warning" : "success"}
        />
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
