"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ArchiveTrip = {
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

export default function AdminArchivePage() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [trips, setTrips] = useState<ArchiveTrip[]>([]);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  async function searchTrips() {
    setLoading(true);
    setMsg(null);

    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    const res = await fetch(`/api/admin/archive?${params.toString()}`, {
      cache: "no-store",
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      setMsg("Admin archive route is not returning JSON.");
      setLoading(false);
      return;
    }

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to search archive.");
      setLoading(false);
      return;
    }

    setTrips(json.trips ?? []);
    setLoading(false);
  }

  useEffect(() => {
    searchTrips();
  }, []);

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">MOOVU Admin</div>
            <h1 className="text-3xl font-semibold mt-1">Trip Archive</h1>
            <p className="text-gray-700 mt-2">
              Search trips by trip ID, rider, phone, address, driver ID, status and date.
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              href="/admin/trips"
              className="border rounded-xl px-4 py-2 bg-white"
            >
              Back to Dispatch
            </Link>

            <button
              onClick={searchTrips}
              className="rounded-xl px-4 py-2 text-white"
              style={{ background: "var(--moovu-primary)" }}
            >
              Search
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
          <h2 className="text-xl font-semibold">Filters</h2>

          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
            <input
              className="rounded-xl p-3 border"
              placeholder="Search trip ID, rider, phone, address, driver ID"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <select
              className="rounded-xl p-3 border bg-white"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="requested">Requested</option>
              <option value="offered">Offered</option>
              <option value="assigned">Assigned</option>
              <option value="arrived">Arrived</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <input
              type="date"
              className="rounded-xl p-3 border"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />

            <input
              type="date"
              className="rounded-xl p-3 border"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Results</h2>

          {loading ? (
            <p className="text-gray-700">Searching...</p>
          ) : trips.length === 0 ? (
            <p className="text-gray-700">No trips found.</p>
          ) : (
            <div className="space-y-3">
              {trips.map((trip) => (
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
                      <div className="text-sm text-gray-600">Trip ID</div>
                      <div className="font-medium break-all">{trip.id}</div>
                    </div>
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
                      <div className="text-sm text-gray-600">Status</div>
                      <div className="font-medium">{trip.status ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Driver ID</div>
                      <div className="font-medium break-all">{trip.driver_id ?? "—"}</div>
                    </div>
                  </div>

                  <div className="mt-4 text-sm text-gray-600">
                    {trip.created_at ? new Date(trip.created_at).toLocaleString() : "—"}
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