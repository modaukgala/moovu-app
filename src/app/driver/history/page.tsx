"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type DriverTrip = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  status: string | null;
  created_at: string | null;
  driver_id: string | null;
};

function money(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `R${n.toFixed(2)}`;
}

export default function DriverHistoryPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [filter, setFilter] = useState("all");

  async function loadTrips() {
    setLoading(true);
    setMsg(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      window.location.href = "/driver/login";
      return;
    }

    const res = await fetch("/api/driver/history", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: "no-store",
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      setMsg("Driver history route is not returning JSON.");
      setLoading(false);
      return;
    }

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load trip history.");
      setLoading(false);
      return;
    }

    setTrips(json.trips ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadTrips();
  }, []);

  const filteredTrips = useMemo(() => {
    if (filter === "all") return trips;
    return trips.filter((t) => t.status === filter);
  }, [trips, filter]);

  if (loading) {
    return (
      <main className="min-h-screen px-6 py-10 text-black">
        <div className="max-w-6xl mx-auto border rounded-[2rem] p-6 bg-white shadow-sm">
          Loading trip history...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">MOOVU Driver</div>
            <h1 className="text-3xl font-semibold mt-1">Trip History</h1>
            <p className="text-gray-700 mt-2">
              View your completed, cancelled and active trip history.
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
              onClick={loadTrips}
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

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              className="border rounded-xl px-4 py-2 bg-white"
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              className="border rounded-xl px-4 py-2 bg-white"
              onClick={() => setFilter("completed")}
            >
              Completed
            </button>
            <button
              className="border rounded-xl px-4 py-2 bg-white"
              onClick={() => setFilter("cancelled")}
            >
              Cancelled
            </button>
            <button
              className="border rounded-xl px-4 py-2 bg-white"
              onClick={() => setFilter("ongoing")}
            >
              Ongoing
            </button>
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Trips</h2>

          {filteredTrips.length === 0 ? (
            <p className="text-gray-700">No trips found for this filter.</p>
          ) : (
            <div className="space-y-3">
              {filteredTrips.map((trip) => (
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

                  <div className="grid md:grid-cols-5 gap-4 mt-4">
                    <div>
                      <div className="text-sm text-gray-600">Rider</div>
                      <div className="font-medium">{trip.rider_name ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Phone</div>
                      <div className="font-medium">{trip.rider_phone ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Fare</div>
                      <div className="font-medium">{money(trip.fare_amount)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Payment</div>
                      <div className="font-medium">{trip.payment_method ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Status</div>
                      <div className="font-medium">{trip.status ?? "—"}</div>
                    </div>
                  </div>

                  <div className="mt-4 text-sm text-gray-600">
                    {trip.created_at
                      ? new Date(trip.created_at).toLocaleString()
                      : "—"}
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