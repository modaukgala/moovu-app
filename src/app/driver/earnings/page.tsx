"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabase/client";

type CompletedTrip = {
  id: string;
  fare_amount: number | null;
  payment_method: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  status: string | null;
  created_at: string | null;
};

type EarningsPayload = {
  today_total: number;
  week_total: number;
  month_total: number;
  total_completed_trips: number;
  recent_completed_trips: CompletedTrip[];
};

function money(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `R${n.toFixed(2)}`;
}

export default function DriverEarningsPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<EarningsPayload | null>(null);

  async function loadEarnings() {
    setLoading(true);
    setMsg(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      window.location.href = "/driver/login";
      return;
    }

    const res = await fetch("/api/driver/earnings", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: "no-store",
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      setMsg("Earnings route is not returning JSON.");
      setLoading(false);
      return;
    }

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load earnings.");
      setLoading(false);
      return;
    }

    setEarnings(json.earnings ?? null);
    setLoading(false);
  }

  useEffect(() => {
    loadEarnings();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen px-6 py-10 text-black">
        <div className="max-w-5xl mx-auto border rounded-[2rem] p-6 bg-white shadow-sm">
          Loading earnings...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">MOOVU Driver</div>
            <h1 className="text-3xl font-semibold mt-1">Earnings Dashboard</h1>
            <p className="text-gray-700 mt-2">
              Track your recent completed trips and income.
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              href="/driver"
              className="border rounded-xl px-4 py-2 bg-white"
            >
              Back to Driver
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

        {msg && (
          <div
            className="border rounded-2xl p-4 text-sm"
            style={{ background: "var(--moovu-primary-soft)" }}
          >
            {msg}
          </div>
        )}

        {!earnings ? (
          <div className="border rounded-[2rem] p-6 bg-white shadow-sm">
            No earnings data found.
          </div>
        ) : (
          <>
            <section className="grid md:grid-cols-4 gap-4">
              <div className="border rounded-2xl p-5 bg-white shadow-sm">
                <div className="text-sm text-gray-600">Today</div>
                <div className="text-3xl font-semibold mt-2">
                  {money(earnings.today_total)}
                </div>
              </div>

              <div className="border rounded-2xl p-5 bg-white shadow-sm">
                <div className="text-sm text-gray-600">This Week</div>
                <div className="text-3xl font-semibold mt-2">
                  {money(earnings.week_total)}
                </div>
              </div>

              <div className="border rounded-2xl p-5 bg-white shadow-sm">
                <div className="text-sm text-gray-600">This Month</div>
                <div className="text-3xl font-semibold mt-2">
                  {money(earnings.month_total)}
                </div>
              </div>

              <div className="border rounded-2xl p-5 bg-white shadow-sm">
                <div className="text-sm text-gray-600">Completed Trips</div>
                <div className="text-3xl font-semibold mt-2">
                  {earnings.total_completed_trips}
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

                      <div className="grid md:grid-cols-4 gap-4 mt-4">
                        <div>
                          <div className="text-sm text-gray-600">Fare</div>
                          <div className="font-semibold">{money(trip.fare_amount)}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">Payment</div>
                          <div className="font-semibold">{trip.payment_method ?? "—"}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">Status</div>
                          <div className="font-semibold">{trip.status ?? "—"}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-600">Completed</div>
                          <div className="font-semibold">
                            {trip.created_at
                              ? new Date(trip.created_at).toLocaleString()
                              : "—"}
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