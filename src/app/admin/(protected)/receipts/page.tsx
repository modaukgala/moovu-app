"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type ReceiptTrip = {
  id: string;
  rider_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  status: string | null;
  created_at: string | null;
  completed_at: string | null;
};

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  return new Date(value).toLocaleString();
}

export default function AdminReceiptsPage() {
  const [trips, setTrips] = useState<ReceiptTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [retrievalWarning, setRetrievalWarning] = useState<string | null>(null);

  async function loadReceipts(requestedPage = page) {
    setLoading(true);
    setMsg(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session?.access_token) throw new Error("Please sign in as an admin to view receipts.");
      const params = new URLSearchParams({ page: String(requestedPage), pageSize: "25", q: query.trim(), status });
      const res = await fetch(`/api/admin/receipts?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Could not load receipts. Please refresh or contact admin support.");
      setTrips(Array.isArray(json.receipts) ? json.receipts : []);
      setPage(Number(json.page ?? requestedPage));
      setTotalPages(Number(json.totalPages ?? json.availablePages ?? 0));
      setRetrievalWarning(json.retrievalWarning ?? null);
    } catch (error) {
      setTrips([]);
      setMsg(error instanceof DOMException && error.name === "AbortError"
        ? "The receipts request timed out. Please retry."
        : error instanceof Error ? error.message : "Could not load receipts.");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReceipts();
    }, 0);
    return () => window.clearTimeout(timer);
    // Initial load only; filter and page changes are submitted explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="space-y-5">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
      {retrievalWarning && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">{retrievalWarning}</section>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="moovu-section-title">Receipts</div>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">
            Trip receipts
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Open printable receipts for completed and cancelled trips.
          </p>
        </div>

        <button type="button" onClick={() => void loadReceipts()} className="moovu-btn moovu-btn-secondary">
          Refresh
        </button>
      </div>

      <section className="moovu-card flex flex-wrap gap-3 p-4">
        <input className="moovu-input min-w-64 flex-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search trip, customer, route, phone, or driver" />
        <select className="moovu-input bg-white" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">Completed and cancelled</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button className="moovu-btn moovu-btn-primary" onClick={() => void loadReceipts(1)}>Search</button>
      </section>

      <section className="moovu-card overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-5">
            <div className="moovu-skeleton h-5 w-44" />
            <div className="moovu-skeleton h-20 w-full" />
            <div className="moovu-skeleton h-20 w-full" />
          </div>
        ) : trips.length === 0 ? (
          <div className="p-5 text-sm text-slate-600">No receipts are available yet.</div>
        ) : (
          <div className="divide-y divide-[var(--moovu-border)]">
            {trips.map((trip) => (
              <div key={trip.id} className="grid gap-4 p-4 md:grid-cols-[1.4fr_1fr_0.7fr_0.7fr_auto] md:items-center">
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-950">{trip.rider_name || "Rider"}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {trip.pickup_address || "--"} to {trip.dropoff_address || "--"}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Issued</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {formatDate(trip.completed_at ?? trip.created_at)}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Fare</div>
                  <div className="mt-1 text-sm font-black text-slate-950">{money(trip.fare_amount)}</div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Status</div>
                  <div className="mt-1 text-sm font-semibold capitalize text-slate-900">
                    {trip.status || "--"}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link href={`/admin/trips/${trip.id}`} className="moovu-btn moovu-btn-secondary">
                    Trip detail
                  </Link>
                  <Link href={`/admin/receipts/${trip.id}`} className="moovu-btn moovu-btn-primary">
                    Receipt
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="flex items-center justify-center gap-3">
        <button className="moovu-btn moovu-btn-secondary" disabled={page <= 1 || loading} onClick={() => void loadReceipts(page - 1)}>Previous</button>
        <span className="text-sm font-bold">Page {page} of {Math.max(1, totalPages)}</span>
        <button className="moovu-btn moovu-btn-secondary" disabled={page >= totalPages || loading} onClick={() => void loadReceipts(page + 1)}>Next</button>
      </div>
    </main>
  );
}
