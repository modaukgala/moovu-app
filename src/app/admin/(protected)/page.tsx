"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
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
    loadAnalytics();
  }, []);

  if (loading) {
    return <main className="p-6 text-black">Loading admin dashboard...</main>;
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">MOOVU Admin</div>
          <h1 className="text-3xl font-semibold mt-1">Operations Dashboard</h1>
          <p className="text-gray-700 mt-2">
            Live platform intelligence for scheduling, quality and support.
          </p>
        </div>

        <section className="grid md:grid-cols-3 gap-4">
          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Scheduled Due Next Hour</div>
            <div className="text-2xl font-semibold mt-2">
              {analytics?.scheduled_due_next_hour ?? 0}
            </div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Scheduled Pending Total</div>
            <div className="text-2xl font-semibold mt-2">
              {analytics?.scheduled_total_pending ?? 0}
            </div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Open Support Issues</div>
            <div className="text-2xl font-semibold mt-2">
              {analytics?.open_support_issues ?? 0}
            </div>
          </div>
        </section>

        <section className="grid lg:grid-cols-2 gap-6">
          <div className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Top Drivers</h2>

            {(analytics?.top_drivers?.length ?? 0) === 0 ? (
              <div>No quality metrics available yet.</div>
            ) : (
              <div className="space-y-3">
                {analytics!.top_drivers.map((driver) => (
                  <div key={driver.driver_id} className="border rounded-xl p-4">
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

          <div className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Low Rated Drivers</h2>

            {(analytics?.low_rated_drivers?.length ?? 0) === 0 ? (
              <div>No low-rated drivers currently flagged.</div>
            ) : (
              <div className="space-y-3">
                {analytics!.low_rated_drivers.map((driver) => (
                  <div key={driver.driver_id} className="border rounded-xl p-4">
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

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
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