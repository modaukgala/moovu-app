"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { readFinancialJson, useFinancialRead } from "@/lib/admin/useFinancialRead";
import type { readPayoutEstimates } from "@/lib/finance/payoutEstimateRead";

type Result = Awaited<ReturnType<typeof readPayoutEstimates>>;
const money = (cents: number | null) => cents === null ? "Unavailable" : `R${(cents / 100).toFixed(2)}`;

export default function CommissionFirstEstimates({ driverId }: { driverId?: string }) {
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page) });
  if (driverId) params.set("driverId", driverId);
  const key = `/api/${driverId ? "admin" : "driver"}/payout-estimates?${params}`;
  const read = useCallback(async (url: string, signal: AbortSignal) => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return readFinancialJson<Result>(url, session?.access_token ?? null, signal,
      (body) => Array.isArray(body.rows) && Number.isSafeInteger(body.total));
  }, []);
  const report = useFinancialRead(key, read);
  return <section className="moovu-card p-5 space-y-3">
    <h2 className="font-bold">Commission-first payout estimates</h2>
    <p>Each trip is an independent estimate using current debt and estimated provider fees. Estimates do not settle debt and must not be added together.</p>
    <p>Confirmed allocation · Unavailable | Recorded manual payout · Unavailable | Bank verification · Unavailable</p>
    {report.loading && <p role="status">Loading payout estimates…</p>}
    {report.error && <p role="alert">{report.error} {report.data && "Showing previously loaded estimates."} <button onClick={report.retry}>Retry estimates</button></p>}
    {report.data && <>
      <p>Driver {report.data.driverId} · Current authoritative commission debt {money(report.data.currentDebtCents)}</p>
      {!report.data.rows.length && <p>No completed online trips on this page.</p>}
      {report.data.rows.map((row) => <article key={row.tripId} className="moovu-data-row">
        {driverId ? <Link href={`/admin/trips/${row.tripId}`}>Trip {row.tripId}</Link> : <p>Trip {row.tripId}</p>}
        <p>Completed · {row.completedAt ? new Date(row.completedAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }) : "Unavailable"}</p>
        {row.estimate ? <>
          <p>Verified payment {money(row.estimate.customerPaymentCents)} · Ride fare {money(row.estimate.fareCents)} · Driver booking share {money(row.estimate.driverBookingShareCents)}</p>
          <p>Estimated percentage fee share {money(row.estimate.percentageFeeCents)} · Fixed fee contribution {money(row.estimate.fixedFeeCents)}</p>
          <p>Estimated gross {money(row.estimate.grossCents)} · Estimated recovery {money(row.estimate.recoveryCents)} · Estimated net {money(row.estimate.netCents)} · Estimated remaining debt {money(row.estimate.remainingCents)}</p>
          {row.estimate.requiresReview && <p>Insufficient fee coverage · review required</p>}
        </> : <p>Estimate unavailable · {row.reason}</p>}
      </article>)}
      <button disabled={page <= 1 || report.loading} onClick={() => setPage(page - 1)}>Previous</button>
      <span> Page {page} · {report.data.total} completed online trips </span>
      <button disabled={page * report.data.pageSize >= report.data.total || report.loading} onClick={() => setPage(page + 1)}>Next</button>
    </>}
  </section>;
}
