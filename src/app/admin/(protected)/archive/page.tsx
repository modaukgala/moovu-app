"use client";

import Link from "next/link";
import { archiveQuery, archiveRequest } from "@/lib/admin/archiveContext";
import { useSearchParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
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
  return <Suspense fallback={<p role="status">Loading…</p>}><PageContent /></Suspense>;
}

function PageContent() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [trips, setTrips] = useState<ArchiveTrip[]>([]);

  const urlQuery = archiveQuery(useSearchParams());
  const [search, setSearch] = useState({ url: urlQuery, value: urlQuery });
  if (search.url !== urlQuery) setSearch({ url: urlQuery, value: urlQuery });
  const q = search.url === urlQuery ? search.value : urlQuery;
  const setQ = (value: string) => { setSearch({ url: urlQuery, value }); setPage(1); };
  const request = useRef<AbortController | null>(null);
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [retrievalWarning, setRetrievalWarning] = useState<string | null>(null);

  const searchTrips = useCallback(async (requestedPage = 1) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    setMsg(null);

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) throw new Error("Sign in to search the archive.");
      controller.signal.throwIfAborted();
      const res = await fetch(archiveRequest({ q, status, dateFrom, dateTo, page: requestedPage }), {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setTrips([]);
        setMsg("Admin archive route is not returning JSON.");
        return;
      }

      const json = await res.json().catch(() => null);

      controller.signal.throwIfAborted();
      if (!res.ok || !json?.ok) {
        setTrips([]);
        setMsg(json?.error || "Failed to search archive.");
        return;
      }

      setTrips((json.trips ?? []) as ArchiveTrip[]);
      setPage(Number(json.page ?? requestedPage));
      setTotalPages(Number(json.totalPages ?? json.availablePages ?? 0));
      setRetrievalWarning(json.retrievalWarning ?? null);
    } catch {
      if (request.current !== controller) return;
      setTrips([]);
      setMsg("Failed to search archive.");
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
  }, [dateFrom, dateTo, q, status]);

  useEffect(() => {
    void searchTrips(1);
    return () => { request.current?.abort(); request.current = null; };
  }, [searchTrips, urlQuery]);

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
              Back to Trips
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
              aria-label="Search trip archive" placeholder="Search trip, customer, phone, address or driver"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <select
              className="moovu-input"
              aria-label="Trip status"
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
              aria-label="From date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />

            <input
              type="date"
              className="moovu-input"
              aria-label="To date"
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
