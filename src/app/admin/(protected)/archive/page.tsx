"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";

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
  driver_name: string | null;
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
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [retrievalWarning, setRetrievalWarning] = useState<string | null>(null);

  const searchTrips = useCallback(async (requestedPage = page) => {
    setLoading(true);
    setMsg(null);

    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      params.set("page", String(requestedPage));
      params.set("pageSize", "25");

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`/api/admin/archive?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      window.clearTimeout(timeout);

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setTrips([]);
        setMsg("Admin archive route is not returning JSON.");
        return;
      }

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setTrips([]);
        setMsg(json?.error || "Failed to search archive.");
        return;
      }

      setTrips((json.trips ?? []) as ArchiveTrip[]);
      setPage(Number(json.page ?? requestedPage));
      setTotalPages(Number(json.totalPages ?? json.availablePages ?? 0));
      setRetrievalWarning(json.retrievalWarning ?? null);
    } catch {
      setTrips([]);
      setMsg("Failed to search archive.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, page, q, status]);

  useEffect(() => {
    void searchTrips();
  }, [searchTrips]);

  return (
    <main className="text-black">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="moovu-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <div className="moovu-section-title">MOOVU Admin</div>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Trip archive</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Search trips by trip reference, customer, phone, address, driver name, status and date.
            </p>
          </div>

          <div className="moovu-action-row">
            <Link href="/admin/trips" className="moovu-btn moovu-btn-secondary">
              Back to Dispatch
            </Link>

            <button
              onClick={() => void searchTrips(1)}
              className="moovu-btn moovu-btn-primary"
            >
              Search
            </button>
          </div>
        </header>

        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
        {retrievalWarning && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">{retrievalWarning}</section>}

        <section className="moovu-card space-y-4 p-5 sm:p-6">
          <h2 className="text-xl font-black">Filters</h2>

          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
            <input
              className="moovu-input"
              placeholder="Search trip, customer, phone, address or driver"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <select
              className="moovu-input"
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
              className="moovu-input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />

            <input
              type="date"
              className="moovu-input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </section>

        <section className="moovu-card space-y-4 p-5 sm:p-6">
          <h2 className="text-xl font-black">Results</h2>

          {loading ? (
            <p className="text-gray-700">Searching...</p>
          ) : trips.length === 0 ? (
            <p className="text-gray-700">No trips found.</p>
          ) : (
            <div className="space-y-3">
              {trips.map((trip) => (
                <div key={trip.id} className="moovu-data-row">
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
                      <div className="text-sm text-gray-600">Driver</div>
                      <div className="font-medium">{trip.driver_name ?? "Unassigned"}</div>
                    </div>
                  </div>

                  <div className="mt-4 text-sm text-gray-600">
                    {trip.created_at ? new Date(trip.created_at).toLocaleString() : "—"}
                  </div>
                  <Link href={`/admin/trips/${trip.id}`} className="mt-4 inline-flex moovu-btn moovu-btn-primary">Open trip detail</Link>
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="flex items-center justify-center gap-3">
          <button className="moovu-btn moovu-btn-secondary" disabled={page <= 1 || loading} onClick={() => void searchTrips(page - 1)}>Previous</button>
          <span className="text-sm font-bold">Page {page} of {Math.max(1, totalPages)}</span>
          <button className="moovu-btn moovu-btn-secondary" disabled={page >= totalPages || loading} onClick={() => void searchTrips(page + 1)}>Next</button>
        </div>
      </div>
    </main>
  );
}
