"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { MOOVU_COMMISSION_RATE } from "@/lib/finance/commission";

type CompletedTrip = {
  id: string;
  driver_id: string | null;
  driver_name?: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  status: string | null;
  created_at: string | null;
  completed_at?: string | null;
  commission_amount?: number | null;
  driver_net_earnings?: number | null;
};

type AdminEarnings = {
  today_total: number;
  week_total: number;
  month_total: number;
  today_commission?: number;
  week_commission?: number;
  month_commission?: number;
  total_revenue: number;
  total_commission: number;
  estimated_driver_payout: number;
  commission_rate?: number;
  total_completed_trips: number;
  by_payment_method: Record<
    string,
    number | { revenue: number; commission: number; count: number }
  >;
  recent_completed_trips: CompletedTrip[];
};

function money(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `R${n.toFixed(2)}`;
}

export default function AdminEarningsPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<AdminEarnings | null>(null);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }, []);

  const loadEarnings = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setMsg("You are not logged in.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/admin/earnings", {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      setMsg("Admin earnings route is not returning JSON.");
      setLoading(false);
      return;
    }

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load admin earnings.");
      setLoading(false);
      return;
    }

    setEarnings(json.earnings ?? null);
    setLoading(false);
  }, [getAccessToken]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadEarnings();
    }, 0);

    return () => window.clearTimeout(initialLoad);
  }, [loadEarnings]);

  if (loading) {
    return (
      <main className="min-h-screen px-6 py-10 text-black">
        <div className="max-w-6xl mx-auto border rounded-[2rem] p-6 bg-white shadow-sm">
          Loading admin earnings...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">MOOVU Admin</div>
            <h1 className="text-3xl font-semibold mt-1">Earnings Dashboard</h1>
            <p className="text-gray-700 mt-2">
              Track revenue, commission, payouts and recent completed trips.
            </p>
          </div>

          <div className="flex gap-2">
            <Link href="/admin/trips" className="border rounded-xl px-4 py-2 bg-white">
              Back to Dispatch
            </Link>

            <button
              onClick={loadEarnings}
              className="rounded-xl px-4 py-2 text-white"
              style={{ background: "var(--moovu-primary)" }}
            >
              Refresh
            </button>
          </div>
        </div>

        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
        {!earnings ? (
          <div className="border rounded-[2rem] p-6 bg-white shadow-sm">
            No earnings data found.
          </div>
        ) : (
          <>
            <section className="grid md:grid-cols-3 xl:grid-cols-6 gap-4">
              <div className="border rounded-2xl p-5 bg-white shadow-sm">
                <div className="text-sm text-gray-600">Today</div>
                <div className="text-2xl font-semibold mt-2">{money(earnings.today_total)}</div>
              </div>

              <div className="border rounded-2xl p-5 bg-white shadow-sm">
                <div className="text-sm text-gray-600">This Week</div>
                <div className="text-2xl font-semibold mt-2">{money(earnings.week_total)}</div>
              </div>

              <div className="border rounded-2xl p-5 bg-white shadow-sm">
                <div className="text-sm text-gray-600">This Month</div>
                <div className="text-2xl font-semibold mt-2">{money(earnings.month_total)}</div>
              </div>

              <div className="border rounded-2xl p-5 bg-white shadow-sm">
                <div className="text-sm text-gray-600">Total Revenue</div>
                <div className="text-2xl font-semibold mt-2">{money(earnings.total_revenue)}</div>
              </div>

              <div className="border rounded-2xl p-5 bg-white shadow-sm">
                <div className="text-sm text-gray-600">MOOVU Commission</div>
                <div className="text-2xl font-semibold mt-2">{money(earnings.total_commission)}</div>
              </div>

              <div className="border rounded-2xl p-5 bg-white shadow-sm">
                <div className="text-sm text-gray-600">Driver Net</div>
                <div className="text-2xl font-semibold mt-2">
                  {money(earnings.estimated_driver_payout)}
                </div>
              </div>
            </section>

            <section className="grid lg:grid-cols-2 gap-6">
              <div className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
                <h2 className="text-xl font-semibold">Payment Methods</h2>

                {Object.keys(earnings.by_payment_method).length === 0 ? (
                  <p className="text-gray-700">No payment data yet.</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(earnings.by_payment_method).map(([key, value]) => {
                      const revenue =
                        typeof value === "number" ? value : value.revenue;
                      const commission =
                        typeof value === "number" ? null : value.commission;
                      const count =
                        typeof value === "number" ? null : value.count;

                      return (
                        <div key={key} className="border rounded-2xl p-4">
                          <div className="flex items-center justify-between">
                            <div className="capitalize font-medium">{key}</div>
                            <div className="font-semibold">{money(revenue)}</div>
                          </div>

                          {(commission != null || count != null) && (
                            <div className="text-sm text-gray-600 mt-2">
                              {commission != null && <>Commission: {money(commission)}</>}
                              {commission != null && count != null && " • "}
                              {count != null && <>Trips: {count}</>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
                <h2 className="text-xl font-semibold">Completed Trips</h2>

                <div className="border rounded-2xl p-4">
                  <div className="text-sm text-gray-600">Total Completed Trips</div>
                  <div className="text-3xl font-semibold mt-2">
                    {earnings.total_completed_trips}
                  </div>
                </div>

                <div className="border rounded-2xl p-4">
                  <div className="text-sm text-gray-600">Commission Rate</div>
                  <div className="text-3xl font-semibold mt-2">
                    {((earnings.commission_rate ?? MOOVU_COMMISSION_RATE) * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
            </section>

            <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
              <h2 className="text-xl font-semibold">Recent Completed Trips</h2>

              {earnings.recent_completed_trips.length === 0 ? (
                <p className="text-gray-700">No completed trips yet.</p>
              ) : (
                <div className="space-y-3">
                  {earnings.recent_completed_trips.map((trip) => (
                    <div key={trip.id} className="border rounded-2xl p-4">
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm text-gray-600">Pickup</div>
                          <div className="font-medium">{trip.pickup_address ?? "—"}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">Dropoff</div>
                          <div className="font-medium">{trip.dropoff_address ?? "—"}</div>
                        </div>
                      </div>

                      <div className="grid md:grid-cols-6 gap-4 mt-4">
                        <div>
                          <div className="text-sm text-gray-600">Fare</div>
                          <div className="font-semibold">{money(trip.fare_amount)}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">Commission</div>
                          <div className="font-semibold">
                            {money(trip.commission_amount)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">Driver Net</div>
                          <div className="font-semibold">
                            {money(trip.driver_net_earnings)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">Driver</div>
                          <div className="font-semibold">{trip.driver_name ?? "—"}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">Completed</div>
                          <div className="font-semibold">
                            {(trip.completed_at ?? trip.created_at) ? new Date(trip.completed_at ?? trip.created_at!).toLocaleString() : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
