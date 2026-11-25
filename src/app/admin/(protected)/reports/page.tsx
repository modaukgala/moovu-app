"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { reportingDay, type EarningsTrip } from "@/lib/admin/earningsMetrics";
import { readFinancialJson, useFinancialRead } from "@/lib/admin/useFinancialRead";

type Amount = number | null;
type Section = { value: Amount; complete: boolean } | null;
type Report = {
  pageSize: number;
  historical: { count: number; relationship: string; rows: {
    id: string; trip_id: string | null; created_at: string | null; fee_type: string | null; trip_status: string | null;
    fee_amount: Amount; driver_amount: Amount; moovu_amount: Amount;
  }[] } | null;
  overview: {
    trips: { gross: Amount; commission: Amount; net: Amount } | null;
    tripsComplete: boolean | null; direct: Section; subscriptions: Section; membership: Section; debt: Section;
    online: { total: number } | null; asOf: string;
  } | null;
  trips: { rows: EarningsTrip[]; count: number } | null;
  cancellations: { count: number; rows: {
    id: string; trip_id: string | null; assessed_at: string; fee_type: string; fee_cents: Amount;
    liability: { original_cents: number; open_cents: number; status: string } | null;
    compensation: { earned_cents: number; settled_cents: number; status: string } | null;
    liabilityUnavailable: boolean; compensationUnavailable: boolean;
  }[] } | null;
  cancellationSummary: { complete: boolean | null; assessed: Amount; driverShare: Amount; platformShare: Amount };
};

const money = (value?: Amount) => value == null ? "Unavailable" : `R${value.toFixed(2)}`;
const cents = (value?: Amount) => money(value == null ? null : value / 100);
const metric = (section?: Section) => section?.complete === false ? "Unavailable · retrieval limit reached" : money(section?.value);
const date = (value?: string) => value ? new Date(value).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }) : "Unavailable";

function Pages({ page, size, count, change }: { page: number; size: number; count: number; change: (page: number) => void }) {
  return <div className="flex gap-3">
    <button disabled={page <= 1} onClick={() => change(page - 1)}>Previous</button>
    <span>Page {page} · {count} records</span>
    <button disabled={page * size >= count} onClick={() => change(page + 1)}>Next</button>
  </div>;
}

export default function AdminReportsPage() {
  const [from, setFrom] = useState(() => reportingDay(new Date(Date.now() - 7 * 86400000)));
  const [to, setTo] = useState(() => reportingDay(new Date()));
  const [page, setPage] = useState(1);
  const [cancellationPage, setCancellationPage] = useState(1);
  const [historicalPage, setHistoricalPage] = useState(1);
  const [historicalDates, setHistoricalDates] = useState("period");
  const query = new URLSearchParams({ from, to, page: String(page), cancellationPage: String(cancellationPage),
    historicalPage: String(historicalPage), historicalDates }).toString();
  const read = useCallback(async (key: string, signal: AbortSignal) => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return readFinancialJson<Report>(`/api/admin/reports?${key}`, session?.access_token ?? null, signal,
      (body) => Number.isSafeInteger(body.pageSize) && !!body.cancellationSummary);
  }, []);
  const report = useFinancialRead(query, read);
  const data = report.data;
  const overview = data?.overview;
  const resetPages = () => { setPage(1); setCancellationPage(1); setHistoricalPage(1); };

  return <main className="space-y-6">
    <header className="moovu-card p-5 space-y-2">
      <h1 className="text-2xl font-bold">Financial reports</h1>
      <p>Inclusive reporting dates · Africa/Johannesburg</p>
      <label>From <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); resetPages(); }} /></label>
      <label>To <input type="date" value={to} onChange={(event) => { setTo(event.target.value); resetPages(); }} /></label>
      <button onClick={() => void report.reload()}>Refresh report</button>
    </header>
    {report.loading && <p role="status">Loading financial report…</p>}
    {report.error && <p role="alert">{report.error} {data && "Showing the previously loaded report."} <button onClick={report.retry}>Retry report</button></p>}
    {data && <>
      <section className="moovu-card p-5 space-y-2">
        <h2 className="font-bold">Selected-period activity</h2>
        <p>Gross recorded fares · {money(overview?.trips?.gross)}</p>
        <p>Commission accrued · {money(overview?.trips?.commission)}</p>
        <p>Driver net earnings · {money(overview?.trips?.net)}</p>
        {overview?.tripsComplete === false && <p>Complete trip totals unavailable · retrieval limit reached.</p>}
        <p>Recorded direct commission collections · {metric(overview?.direct)}</p>
        <p>Provider-verified online receipts · {money(overview?.online?.total)}</p>
        <p>Recorded historical subscription receipts · {metric(overview?.subscriptions)}</p>
        <p>MOOVU+ receipts with posted evidence · {metric(overview?.membership)}</p>
        <p>Recorded manual payouts · Unavailable</p><p>Independently verified manual payouts · Unavailable</p>
        <h2 className="font-bold">Current balances</h2>
        <p>Current outstanding commission · {metric(overview?.debt)} · read {date(overview?.asOf)} SAST</p>
        <p>Historical period-end commission balance · Unavailable</p>
        <p>Actual driver payout obligations · Unavailable</p>
      </section>
      <section className="moovu-card p-5 space-y-2">
        <h2 className="font-bold">Completed trips</h2>
        {!data.trips ? <p>Trip history unavailable.</p> : <>
          {!data.trips.rows.length && <p>No completed trips on this page.</p>}
          {data.trips.rows.map((row) => <article key={row.id} className="moovu-data-row">
            <Link href={`/admin/trips/${row.id}`}>Trip {row.id}</Link> · {date(row.completed_at)}
            <p>Fare {money(row.fare_amount)} · Commission {money(row.commission_amount)} ({row.commission_pct == null ? "Rate unavailable" : `${row.commission_pct}%`}) · Driver net {money(row.driver_net_earnings)}</p>
          </article>)}
          <Pages page={page} size={data.pageSize} count={data.trips.count} change={setPage} />
        </>}
      </section>
      <section className="moovu-card p-5 space-y-2">
        <h2 className="font-bold">Historical cancellation records</h2>
        <p>Recorded legacy amounts. Excluded from Phase 4 totals. Collection and payout evidence unavailable.</p>
        <label>Recorded date <select value={historicalDates} onChange={(event) => {
          setHistoricalDates(event.target.value); setHistoricalPage(1);
        }}>
          <option value="period">Selected reporting period</option>
          <option value="unavailable">Unavailable date · outside period filtering</option>
        </select></label>
        {!data.historical ? <p role="alert">Historical cancellation history unavailable. <button onClick={() => void report.reload()}>Retry history</button></p> : <>
          <p>{data.historical.relationship === "unverified" ? "Phase 4 relationships are unverified in this history." : "Records with a stored Phase 4 assessment link are excluded."}</p>
          {!data.historical.rows.length && <p>No historical cancellation records match this filter.</p>}
          {data.historical.rows.map((row) => <article key={row.id} className="moovu-data-row">
            <p>Record {row.id} · {row.trip_id ? <Link href={`/admin/trips/${row.trip_id}`}>Trip {row.trip_id}</Link> : "Stored trip unavailable"}</p>
            <p>Recorded at {date(row.created_at ?? undefined)} · {row.fee_type ?? "Fee type unavailable"}</p>
            <p>Stored trip status · {row.trip_status ?? "Unavailable"}</p>
            <p>Recorded fee {money(row.fee_amount)} · Driver allocation {money(row.driver_amount)} · MOOVU allocation {money(row.moovu_amount)}</p>
          </article>)}
          <Pages page={historicalPage} size={data.pageSize} count={data.historical.count} change={setHistoricalPage} />
        </>}
      </section>
      <section className="moovu-card p-5 space-y-2">
        <h2 className="font-bold">Cancellation accounting</h2>
        <p>Recorded Phase 4 assessments · {money(data.cancellationSummary.assessed)}</p>
        <p>Assessed driver share · {money(data.cancellationSummary.driverShare)}</p>
        <p>Assessed MOOVU allocation · {money(data.cancellationSummary.platformShare)}</p>
        <p>Verified cancellation collections · Unavailable</p><p>Actual driver compensation paid · Unavailable</p>
        {data.cancellationSummary.complete === false && <p>Complete assessment totals unavailable · retrieval limit reached.</p>}
        {!data.cancellations ? <p>Assessment history unavailable.</p> : <>
          {!data.cancellations.rows.length && <p>No Phase 4 assessments on this page.</p>}
          {data.cancellations.rows.map((row) => <article key={row.id} className="moovu-data-row">
            {row.trip_id ? <Link href={`/admin/trips/${row.trip_id}`}>Trip {row.trip_id}</Link> : "Stored trip relationship unavailable"}
            <p>{row.fee_type} · {date(row.assessed_at)} · Assessed {cents(row.fee_cents)}</p>
            <p>{row.liability ? `Recorded liability ${cents(row.liability.original_cents)} · Open now ${cents(row.liability.open_cents)} · ${row.liability.status}` :
              row.liabilityUnavailable ? "Liability read unavailable" : "No linked liability recorded"}</p>
            <p>{row.compensation ? `Recorded compensation ${cents(row.compensation.earned_cents)} · ${row.compensation.status}` :
              row.compensationUnavailable ? "Compensation read unavailable" : "No linked compensation recorded"}</p>
          </article>)}
          <Pages page={cancellationPage} size={data.pageSize} count={data.cancellations.count} change={setCancellationPage} />
        </>}
      </section>
    </>}
  </main>;
}
