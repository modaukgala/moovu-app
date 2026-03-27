"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type RiderTrip = {
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

export default function RiderHistoryPage() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [trips, setTrips] = useState<RiderTrip[]>([]);
  const [filter, setFilter] = useState("all");

  async function searchTrips() {
    const value = phone.trim();
    if (!value) {
      setMsg("Enter your phone number first.");
      return;
    }

    setLoading(true);
    setMsg(null);

    const res = await fetch(
      `/api/public/rider-history?phone=${encodeURIComponent(value)}`,
      { cache: "no-store" }
    );

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      setMsg("Rider history route is not returning JSON.");
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

  const filteredTrips = useMemo(() => {
    if (filter === "all") return trips;
    return trips.filter((t) => t.status === filter);
  }, [trips, filter]);

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">MOOVU Rider</div>
            <h1 className="text-3xl font-semibold mt-1">Trip History</h1>
            <p className="text-gray-700 mt-2">
              Search your past trips using the phone number used when booking.
            </p>
          </div>

          <Link
            href="/"
            className="border rounded-xl px-4 py-2 bg-white"
          >
            Back Home
          </Link>
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
          <h2 className="text-xl font-semibold">Search Trips</h2>

          <div className="grid md:grid-cols-[1fr_auto] gap-3">
            <input
              className="rounded-xl p-3 border"
              placeholder="Enter your booking phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button
              onClick={searchTrips}
              disabled={loading}
              className="rounded-xl px-5 py-3 text-white"
              style={{ background: "var(--moovu-primary)" }}
            >
              {loading ? "Searching..." : "Search History"}
            </button>
          </div>

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
            <p className="text-gray-700">No trips found yet.</p>
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
                      <div className="text-sm text-gray-600">Trip ID</div>
                      <div className="font-medium break-all">{trip.id}</div>
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
                    <div>
                      <div className="text-sm text-gray-600">Date</div>
                      <div className="font-medium">
                        {trip.created_at
                          ? new Date(trip.created_at).toLocaleString()
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <Link
                      href={`/ride/${trip.id}`}
                      className="border rounded-xl px-4 py-2 bg-white inline-block"
                    >
                      Open Trip
                    </Link>
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
