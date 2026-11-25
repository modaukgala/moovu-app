"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { reportingDay, type EarningsTrip, type summariseTrips } from "@/lib/admin/earningsMetrics";
import { createCommissionHistoryRequest } from "@/lib/admin/commissionHistoryRequest";

type Section = { value: number | null; complete: boolean } | null;
type Result = {
  totals?: ReturnType<typeof summariseTrips> | null;
  totalsState?: string;
  trips?: ReturnType<typeof summariseTrips> | null;
  tripsComplete?: boolean | null;
  rows?: (EarningsTrip & { driver_name: string | null })[];
  total?: number; pageSize?: number;
  verifiedOnlineTripReceipts?: number | null;
  online?: { total: number } | null;
  direct?: Section; subscriptions?: Section; membership?: Section; debt?: Section;
  asOf?: string;
};

function money(value?: number | null) {
  return value == null ? "Unavailable" : new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
}

function sectionValue(section?: Section) {
  return section?.complete === false ? "Unavailable · retrieval limit reached" : money(section?.value);
}

export default function AdminRecordedEarnings({ report }: { report?: boolean }) {
  const [from, setFrom] = useState(() => reportingDay(new Date(Date.now() - 7 * 86400000)));
  const [to, setTo] = useState(() => reportingDay(new Date()));
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [request] = useState(() => createCommissionHistoryRequest<string, Result>());
  useEffect(() => {
    const params = new URLSearchParams({ from, to, page: String(page) });
    const path = report ? "/api/admin/reports/driver-earnings" : "/api/admin/earnings";
    void request.run(`${path}?${params}`, async (url, signal) => {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) throw new Error("Sign in to view financial reports.");
      const response = await fetch(url, { signal, cache: "no-store", headers: { Authorization: `Bearer ${session.access_token}` } });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.ok !== true || (report && (!Array.isArray(body.rows) || !Number.isSafeInteger(body.total))) ||
        (!report && typeof body.asOf !== "string")) throw new Error(body?.error || "Earnings report unavailable.");
      return body;
    }, (state) => {
      setLoading(state.loading);
      setError(state.error);
      setResult(state.result);
    });
    return () => request.invalidate();
  }, [from, to, page, report, retry, request]);

  const totals = report ? result?.totals : result?.trips;
  const partial = report ? result?.totalsState === "partial" : result?.tripsComplete === false;
  return <main className="space-y-6">
    <header className="moovu-card p-5">
      <h1 className="text-2xl font-bold">{report ? "Driver Earnings Report" : "Financial Overview"}</h1>
      <p>Selected period · Africa/Johannesburg · inclusive dates</p>
      <div className="flex flex-wrap gap-3">
        <label>From <input type="date" value={from} onChange={(event) => { setPage(1); setFrom(event.target.value); }} /></label>
        <label>To <input type="date" value={to} onChange={(event) => { setPage(1); setTo(event.target.value); }} /></label>
        <button onClick={() => setRetry(retry + 1)}>Refresh</button>
        <Link href={report ? "/admin/earnings" : "/admin/reports/driver-earnings"}>{report ? "Financial overview" : "Driver earnings report"}</Link>
      </div>
    </header>
    {loading && <p role="status">Loading earnings…</p>}
    {error && <p role="alert">{error} <button onClick={() => setRetry(retry + 1)}>Try again</button></p>}
    {result && <section className="moovu-card p-5 space-y-2">
      <h2 className="font-bold">Selected-period activity</h2>
      <p>Completed trips · {totals?.count ?? result.total ?? "Unavailable"}</p>
      <p>Gross recorded fares · {money(totals?.gross)}</p>
      <p>Recorded commission accrued · {money(totals?.commission)}</p>
      <p>Recorded driver net earnings · {money(totals?.net)}</p>
      <p>{partial ? "Trip totals unavailable · retrieval limit reached. History pages remain available in the driver report." :
        totals ? "Complete trip population. Missing snapshots are marked unavailable." : "Trip totals unavailable."}</p>
      {totals && Object.entries(totals.methods).map(([method, summary]) => <p key={method}>{method} · {summary.count} completed · {money(summary.gross)} recorded fares</p>)}
      <p>{report ? "Provider-verified customer trip receipts (verification date)" : "Provider-verified Yoco receipts (verification date)"} · {money(report ? result.verifiedOnlineTripReceipts : result.online?.total)}</p>
      {!report && <>
        <p>Recorded direct commission payments · {sectionValue(result.direct)}</p>
        <p>Internal commission recovery · Unavailable</p>
        <p>Total commission settled across channels · Unavailable</p>
        <p>Recorded historical driver subscription receipts · {sectionValue(result.subscriptions)}</p>
        <p>Verified MOOVU+ receipts · {sectionValue(result.membership)}</p>
        <p>Gross allocated payouts · Unavailable</p><p>Net allocated payouts · Unavailable</p>
        <p>Recorded manual payouts · Unavailable</p><p>Independently verified manual payouts · Unavailable</p>
      </>}
    </section>}
    {result && <section className="moovu-card p-5">
      <h2 className="font-bold">Current financial position</h2>
      {!report && <p>Outstanding commission across drivers · {sectionValue(result.debt)}{result.asOf && ` · read at ${new Date(result.asOf).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })} SAST`}</p>}
      <p>Outstanding driver payout obligations · Unavailable</p>
    </section>}
    {result?.rows && <section className="moovu-card p-5 space-y-3">
      <h2 className="font-bold">Completed trip snapshots by driver</h2>
      {!result.rows.length && <p>No completed trips on this page.</p>}
      {result.rows.map((row) => <article key={row.id} className="moovu-data-row">
        <Link href={`/admin/trips/${row.id}`}>Trip {row.id}</Link>
        <p>{row.driver_name ?? row.driver_id ?? "Driver unavailable"} · {new Date(row.completed_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}</p>
        <p>{row.payment_method ?? "Unknown method"} · Fare {money(row.fare_amount)} · Commission {money(row.commission_amount)} ({row.commission_pct == null ? "rate unavailable" : `${row.commission_pct}%`}) · Driver net {money(row.driver_net_earnings)}</p>
      </article>)}
      <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span> Page {page} · {result.total} completed trips </span>
      <button disabled={page * (result.pageSize ?? 30) >= (result.total ?? 0)} onClick={() => setPage(page + 1)}>Next</button>
    </section>}
  </main>;
}
