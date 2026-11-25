"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { readFinancialJson, useFinancialRead } from "@/lib/admin/useFinancialRead";

type Queue = {
  complete: boolean; total: number | null; retrieved: number; pageSize: number;
  rows: { id: string; trip_id: string | null; tripAvailable: boolean; tripEvidence: string; customer_id: string;
    tripStatus: string | null; provider_payment_id: string | null; dispatch_state: string | null; reconciliation_state: string | null;
    verified_at: string | null; verified: boolean | null; amount_cents: number; currency: string;
    state: string; primary: string | null; reasons: string[];
    issues: { id: string; issue_type: string }[] | null; refunds: { id: string; state: string }[] | null }[];
};

const labels: Record<string, string> = {
  actionable: "Actionable exceptions", all: "All attempts", reconciliation: "Reconciliation required", cancelled: "Cancelled paid trip",
  missing_trip: "Missing trip", dispatch_failed: "Dispatch failed", deferred: "Dispatch deferred", unavailable: "Evidence unavailable",
  awaiting_acceptance: "Awaiting acceptance", normal: "Normal fulfilment",
};

export default function YocoFulfilmentQueue() {
  const [page, setPage] = useState(1);
  const [fulfilment, setFulfilment] = useState("actionable");
  const [state, setPaymentState] = useState("all");
  const key = new URLSearchParams({ view: "fulfilment", page: String(page), fulfilment, state }).toString();
  const read = useCallback(async (query: string, signal: AbortSignal) => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return readFinancialJson<Queue>(`/api/admin/online-payments?${query}`, session?.access_token ?? null, signal,
      (body) => Array.isArray(body.rows) && Number.isSafeInteger(body.retrieved));
  }, []);
  const queue = useFinancialRead(key, read);
  return <section id="fulfilment" className="moovu-card p-5 space-y-3">
    <h2 className="text-xl font-bold">Yoco trip fulfilment</h2>
    <label>Fulfilment <select value={fulfilment} onChange={(event) => { setFulfilment(event.target.value); setPage(1); }}>
      {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <label>Payment attempt status <select value={state} onChange={(event) => { setPaymentState(event.target.value); setPage(1); }}>
      {["all", "CREATED", "PENDING", "FAILED", "SUCCEEDED", "CANCELLED", "EXPIRED", "REFUND_PENDING", "REFUNDED", "PARTIALLY_REFUNDED", "REFUND_FAILED", "RECONCILIATION_REQUIRED"].map((value) =>
        <option key={value} value={value}>{value}</option>)}
    </select></label>
    <button onClick={() => void queue.reload()}>Refresh queue</button>
    {queue.loading && <p role="status">Loading fulfilment records…</p>}
    {queue.error && <p role="alert">{queue.error} {queue.data && "Showing previously loaded records."} <button onClick={queue.retry}>Retry queue</button></p>}
    {queue.data && <>
      <p>{queue.data.complete ? `${queue.data.total} matching payments` : "Complete count unavailable · retrieval or evidence is incomplete."}</p>
      {!queue.data.rows.length && <p>{queue.data.complete ? "No matching payments." : "No matching records in the available results."}</p>}
      {queue.data.rows.map((row) => <article key={row.id} className="moovu-data-row">
        <p>{row.provider_payment_id ?? row.id} · Customer {row.customer_id ?? "Unavailable"}</p>
        <p>{row.state} · {row.verified === true ? `Verified ${new Date(row.verified_at!).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}` :
          row.verified === null ? "Verification evidence unavailable" : "No verified payment established"}</p>
        <p>{row.verified === true ? "Verified amount" : "Recorded attempt amount"} · {row.currency} {(row.amount_cents / 100).toFixed(2)}</p>
        <p>{row.tripAvailable && row.trip_id ? <Link href={`/admin/trips/${row.trip_id}`}>Trip {row.trip_id}</Link> :
          `Trip evidence ${row.tripEvidence}`} · {row.tripStatus ?? "Status unavailable"}</p>
        <p>Fulfilment · {row.primary ? labels[row.primary] : "Unavailable"} · Dispatch {row.dispatch_state ?? "Unavailable"}</p>
        {row.reasons.length > 0 && <p>{row.reasons.map((reason) => labels[reason]).join(" · ")}</p>}
        <p>Reconciliation · {row.reconciliation_state ?? "Unavailable"} · {row.issues === null ? "Open issues unavailable" :
          row.issues.map((issue) => `${issue.issue_type} (${issue.id})`).join(", ") || "No open issue recorded"}</p>
        <p>Refunds · {row.refunds === null ? "Unavailable" : row.refunds.map((refund) => `${refund.state} (${refund.id})`).join(", ") || "None recorded"}</p>
      </article>)}
      <button disabled={queue.loading || page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span> Page {page} </span>
      <button disabled={queue.loading || page * queue.data.pageSize >= queue.data.retrieved} onClick={() => setPage(page + 1)}>Next</button>
    </>}
  </section>;
}
