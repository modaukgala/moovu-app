"use client";

import { useEffect, useState } from "react";
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

  if (loading) {
    return (
      <main className="space-y-5">
        <div className="moovu-card p-6">
          <div className="moovu-section-title">MOOVU Admin</div>
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

      <div className="space-y-6">
        <div className="moovu-card p-6">
          <div className="moovu-section-title">MOOVU Admin</div>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">
            Operations dashboard
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Live platform intelligence for scheduling, quality, support, and payments.
          </p>

          <section className="mt-5 flex flex-wrap gap-3">
            <Link href="/admin/trips" className="moovu-btn moovu-btn-primary">
              Open trips
            </Link>
            <Link href="/admin/payment-reviews" className="moovu-btn moovu-btn-secondary">
              Payment reviews
            </Link>
            <Link href="/admin/receipts" className="moovu-btn moovu-btn-secondary">
              Receipts
            </Link>
            <Link href="/admin/settlements" className="moovu-btn moovu-btn-secondary">
              Settlements
            </Link>
          </section>
        </div>

        <section className="grid gap-4 md:grid-cols-3">
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

        <section className="grid lg:grid-cols-2 gap-6">
          <div className="moovu-card space-y-4 p-6">
            <h2 className="text-xl font-black text-slate-950">Top drivers</h2>

            {(analytics?.top_drivers?.length ?? 0) === 0 ? (
              <div>No quality metrics available yet.</div>
            ) : (
              <div className="space-y-3">
                {analytics!.top_drivers.map((driver) => (
                  <div key={driver.driver_id} className="rounded-2xl border border-[var(--moovu-border)] p-4">
                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <div className="text-sm text-gray-500">Driver</div>
                        <div className="font-medium">{driver.driver_name}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Rating</div>
                        <div className="font-medium">{Number(driver.avg_rating).toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Rated Trips</div>
                        <div className="font-medium">{driver.total_ratings}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Quality Score</div>
                        <div className="font-medium">{Number(driver.quality_score).toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="moovu-card space-y-4 p-6">
            <h2 className="text-xl font-black text-slate-950">Driver quality watchlist</h2>

            {(analytics?.low_rated_drivers?.length ?? 0) === 0 ? (
              <div>No low-rated drivers currently flagged.</div>
            ) : (
              <div className="space-y-3">
                {analytics!.low_rated_drivers.map((driver) => (
                  <div key={driver.driver_id} className="rounded-2xl border border-[var(--moovu-border)] p-4">
                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <div className="text-sm text-gray-500">Driver</div>
                        <div className="font-medium">{driver.driver_name}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Rating</div>
                        <div className="font-medium">{Number(driver.avg_rating).toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Issues</div>
                        <div className="font-medium">{driver.total_issues}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Quality Score</div>
                        <div className="font-medium">{Number(driver.quality_score).toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="moovu-card space-y-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Recent Cancellations</h2>
            <Link href="/admin/trips" className="border rounded-xl px-4 py-2">
              Open Trips
            </Link>
          </div>

          {(analytics?.recent_cancellations?.length ?? 0) === 0 ? (
            <div>No recent cancellations found.</div>
          ) : (
            <div className="space-y-3">
              {analytics!.recent_cancellations.map((item) => (
                <div key={item.id} className="border rounded-xl p-4">
                  <div className="grid md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Trip ID</div>
                      <div className="font-medium break-all">{item.id}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Rider</div>
                      <div className="font-medium">{item.rider_name || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Cancelled By</div>
                      <div className="font-medium">{item.cancelled_by || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Fee</div>
                      <div className="font-medium">{money(item.cancellation_fee_amount)}</div>
                    </div>
                  </div>

                  <div className="text-sm text-gray-500 mt-3">
                    {item.created_at ? new Date(item.created_at).toLocaleString() : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
