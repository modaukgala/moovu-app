"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabase/client";
import type { PaymentReviewFilter, PaymentReviewFulfilment, PaymentReviewFulfilmentFilter, PaymentReviewStatus } from "@/lib/payments/paymentReview";

type Row = {
  id: string; payer: string; amount_cents: number; created_at: string; verified_at: string | null;
  provider_payment_id: string | null; payment_status: PaymentReviewStatus; payment_state: string;
  fulfilment_status: PaymentReviewFulfilment | null; trip_id: string | null; trip_status: string | null;
  driver_name: string | null;
  offers: { driver_id: string; status: string; created_at: string; responded_at: string | null }[];
  offer_history_available: boolean;
};

const STATUS_LABELS: Record<PaymentReviewStatus, string> = {
  pending: "Pending verification", "verified-paid": "Verified paid", failed: "Not paid",
  "refund-review": "Refund state needs investigation", unknown: "Needs investigation",
};
const FULFILMENT_LABELS: Record<PaymentReviewFulfilment, string> = {
  "no-trip": "No linked trip", "awaiting-driver": "Awaiting accepted Driver",
  allocated: "Driver allocated", "in-progress": "Trip in progress", completed: "Trip completed", cancelled: "Trip cancelled",
};
const STATUS_OPTIONS: readonly [PaymentReviewFilter, string][] = [
  ["all", "All payment states"], ["verified-paid", "Verified paid"], ["pending", "Pending"],
  ["failed", "Not paid"], ["refund-review", "Refund review"], ["unknown", "Needs investigation"],
];
const FULFILMENT_OPTIONS: readonly [PaymentReviewFulfilmentFilter, string][] = [
  ["all", "All trip states"], ["needs-review", "Paid trips needing review"],
  ["no-trip", "No linked trip"], ["awaiting-driver", "No accepted Driver"],
  ["allocated", "Driver allocated"], ["in-progress", "In progress"],
  ["completed", "Completed"], ["cancelled", "Cancelled"],
];
const money = (cents: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(cents / 100);
const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short",
}).format(new Date(value)) : "Unavailable";

export default function OnlineFulfilmentReviews() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<PaymentReviewFilter>("verified-paid");
  const [fulfilment, setFulfilment] = useState<PaymentReviewFulfilmentFilter>("needs-review");
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    setBusy(true); setError("");
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) throw new Error("Sign in as a financial Admin to review payments.");
      const params = new URLSearchParams({
        from: new Date(`${from}T00:00:00+02:00`).toISOString(),
        to: new Date(new Date(`${to}T00:00:00+02:00`).getTime() + 86400000).toISOString(),
        page: String(page), status, fulfilment, search,
      });
      const response = await fetch(`/api/admin/online-payment-reviews?${params}`, { cache: "no-store", signal,
        headers: { Authorization: `Bearer ${session.access_token}` } });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error ?? "Could not load online payment reviews.");
      if (!signal.aborted) { setRows(json.rows ?? []); setTotal(json.total ?? 0); }
    } catch (cause) {
      if (!signal.aborted) { setRows([]); setTotal(0); setError(cause instanceof Error ? cause.message : "Could not load online payment reviews."); }
    } finally { if (!signal.aborted) setBusy(false); }
  }, [from, to, page, status, fulfilment, search]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  return <section className="moovu-admin-finance-page space-y-4">
    <div className="moovu-admin-page-heading"><h2 className="text-xl font-bold">Yoco payment and trip review</h2>
      <p className="mt-1 text-sm text-slate-600">Read-only investigation. Payment verification, Driver allocation and trip completion are separate states.</p></div>
    <div className="moovu-admin-filter-panel grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">From<input type="date" className="moovu-input mt-1" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
      <label className="text-sm">To<input type="date" className="moovu-input mt-1" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
      <label className="text-sm">Payment state<select className="moovu-input mt-1" value={status} onChange={(event) => { setStatus(event.target.value as PaymentReviewFilter); setPage(1); }}>
        {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">Trip state<select className="moovu-input mt-1" value={fulfilment} onChange={(event) => { setFulfilment(event.target.value as PaymentReviewFulfilmentFilter); setPage(1); }}>
        {FULFILMENT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <form className="flex gap-2 sm:col-span-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); }}>
        <label className="flex-1 text-sm">Customer or payment reference<input className="moovu-input mt-1" type="search" maxLength={100} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /></label>
        <button type="submit" className="moovu-btn moovu-btn-secondary self-end">Search</button>
      </form>
    </div>
    <p className="text-sm text-slate-600">{total} matching payment attempts. Filters and counts apply before pagination.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {busy ? <p role="status">Loading payment reviews...</p> : !rows.length ? <p className="text-sm text-slate-600">No payment attempts match these filters.</p> :
      <div className="divide-y rounded-lg border bg-white">{rows.map((row) => <button key={row.id} type="button" className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-slate-50" onClick={() => setSelected(row)}>
        <span><strong className="block">{row.payer}</strong><span className="block text-sm text-slate-600">{date(row.verified_at ?? row.created_at)} · {row.provider_payment_id ?? "No payment reference"}</span></span>
        <span className="text-sm"><strong>{money(row.amount_cents)}</strong><span className="block text-slate-600">{STATUS_LABELS[row.payment_status]}{row.fulfilment_status ? ` · ${FULFILMENT_LABELS[row.fulfilment_status]}` : ""}</span></span>
      </button>)}</div>}
    <nav aria-label="Payment review pages" className="flex items-center gap-3"><button type="button" className="moovu-btn moovu-btn-secondary" disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>Previous</button>
      <span className="text-sm">Page {page} of {Math.max(1, Math.ceil(total / 20))}</span><button type="button" className="moovu-btn moovu-btn-secondary" disabled={page * 20 >= total || busy} onClick={() => setPage(page + 1)}>Next</button></nav>
    {selected && <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/50 p-4" onClick={() => setSelected(null)}>
      <section role="dialog" aria-modal="true" aria-labelledby="fulfilment-title" className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex justify-between gap-3"><h2 id="fulfilment-title" className="text-lg font-bold">Payment and trip review</h2><button type="button" aria-label="Close review" onClick={() => setSelected(null)}>Close</button></div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"><dt>Payment</dt><dd>{money(selected.amount_cents)} · {STATUS_LABELS[selected.payment_status]}</dd><dt>Recorded state</dt><dd>{selected.payment_state}</dd>
          <dt>Yoco reference</dt><dd className="break-all">{selected.provider_payment_id ?? "Unavailable"}</dd><dt>Customer</dt><dd>{selected.payer}</dd>
          <dt>Trip</dt><dd className="break-all">{selected.trip_id ?? "No trip linked"}</dd><dt>Trip status</dt><dd>{selected.trip_status ?? "Unavailable"}</dd>
          <dt>Fulfilment</dt><dd>{selected.fulfilment_status ? FULFILMENT_LABELS[selected.fulfilment_status] : "Not a verified paid trip"}</dd>
          <dt>Driver</dt><dd>{selected.driver_name ?? "No accepted Driver recorded"}</dd>
          <dt>Offer attempts</dt><dd>{selected.offer_history_available ? selected.offers.length
            ? selected.offers.map((offer) => <div key={`${offer.driver_id}-${offer.created_at}`}>{offer.status} · {date(offer.created_at)} · Driver ID {offer.driver_id}</div>)
            : "No offer attempts recorded" : "Unavailable"}</dd></dl>
        <p className="mt-4 text-sm text-slate-600">This review does not confirm, refund, reassign or complete a trip.</p>
        <div className="mt-4 flex gap-2"><Link className="moovu-btn moovu-btn-secondary" href="/admin/online-payments">Verified Yoco history</Link>{selected.trip_id && <Link className="moovu-btn moovu-btn-primary" href={`/admin/trips/${selected.trip_id}`}>Open trip</Link>}</div>
      </section></div>}
  </section>;
}
