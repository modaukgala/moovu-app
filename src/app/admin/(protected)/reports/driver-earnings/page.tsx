"use client";

import { useEffect, useMemo, useState } from "react";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";

type Row = {
  driver_id: string;
  name: string;
  phone: string | null;
  status: string | null;
  online: boolean;
  busy: boolean;

  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
  subscription_due: boolean;
  subscription_days_overdue: number;
  subscription_amount_due: number;

  trips_completed: number;
  total_earnings: number;
  cash_trips: number;
  cash_total: number;
  avg_fare: number;

  in_progress_trips: number;
  in_progress_total: number;
  in_progress_by_status: Record<string, number>;
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function DriverEarningsReportPage() {
  const [from, setFrom] = useState<string>(() => isoDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState<string>(() => isoDate(new Date()));

  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [totTrips, setTotTrips] = useState<number>(0);
  const [totEarnings, setTotEarnings] = useState<number>(0);
  const [totInProgress, setTotInProgress] = useState<number>(0);
  const [totInProgressAmount, setTotInProgressAmount] = useState<number>(0);
  const [totSubDue, setTotSubDue] = useState<number>(0);

  async function load() {
    setBusy(true);
    setMsg(null);

    const res = await fetch(
      `/api/admin/reports/driver-earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    const json = await res.json();

    setBusy(false);

    if (!json.ok) {
      setRows([]);
      setMsg(json.error || "Failed to load report");
      return;
    }

    setRows(json.rows ?? []);
    setTotTrips(json.totals?.trips_completed ?? 0);
    setTotEarnings(json.totals?.total_earnings ?? 0);
    setTotInProgress(json.totals?.in_progress_trips ?? 0);
    setTotInProgressAmount(json.totals?.in_progress_total ?? 0);
    setTotSubDue(json.totals?.subscription_due_total ?? 0);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dueCount = useMemo(() => rows.filter((r) => r.subscription_due).length, [rows]);

  return (
    <main className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Driver Earnings Report</h1>
          <p className="opacity-70 mt-1">
            Completed = cash collected by driver. In-progress = active trips not yet completed. Subscription “due” is based on expiry/active status.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <input className="border rounded-xl px-4 py-2" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="border rounded-xl px-4 py-2" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={load}>
            {busy ? "Loading..." : "Run"}
          </button>
        </div>
      </div>

      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <section className="border rounded-2xl p-5">
        <h2 className="font-semibold">Totals</h2>
        <div className="grid md:grid-cols-5 gap-4 mt-4">
          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">Completed trips</div>
            <div className="text-2xl font-semibold mt-1">{totTrips}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">Total earnings (completed)</div>
            <div className="text-2xl font-semibold mt-1">R{totEarnings}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">In-progress trips</div>
            <div className="text-2xl font-semibold mt-1">{totInProgress}</div>
            <div className="text-xs opacity-60 mt-1">Value: R{totInProgressAmount}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">Subscriptions due</div>
            <div className="text-2xl font-semibold mt-1">{dueCount}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">Total subscription due</div>
            <div className="text-2xl font-semibold mt-1">R{totSubDue}</div>
          </div>
        </div>
      </section>

      <section className="border rounded-2xl p-5">
        <h2 className="font-semibold">By Driver</h2>

        {rows.length === 0 ? (
          <p className="opacity-70 mt-3">No data.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {rows.map((r) => {
              const exp = r.subscription_expires_at ? new Date(r.subscription_expires_at).toLocaleDateString() : "—";
              const plan = r.subscription_plan ? ` (${r.subscription_plan})` : "";

              const dueText = r.subscription_due
                ? `DUE${r.subscription_days_overdue > 0 ? ` • ${r.subscription_days_overdue}d overdue` : ""}`
                : "OK";

              const statusBreakdown = Object.keys(r.in_progress_by_status ?? {}).length
                ? Object.entries(r.in_progress_by_status)
                    .map(([k, v]) => `${k}:${v}`)
                    .join(" • ")
                : "—";

              return (
                <div key={r.driver_id} className="border rounded-2xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs opacity-60 mt-1">
                        {r.phone ?? "—"} • driver status: {r.status ?? "—"} • online: {r.online ? "yes" : "no"} • busy:{" "}
                        {r.busy ? "yes" : "no"}
                      </div>

                      <div className="text-xs opacity-60 mt-1">
                        sub: {r.subscription_status ?? "—"}
                        {plan} • exp: {exp} • <span className="font-semibold">{dueText}</span>
                        {r.subscription_due ? (
                          <>
                            {" "}
                            • due amount: <span className="font-semibold">R{r.subscription_amount_due}</span>
                          </>
                        ) : null}
                      </div>

                      <div className="text-xs opacity-60 mt-1">{r.driver_id}</div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm opacity-70">Completed earnings</div>
                      <div className="text-xl font-semibold">R{r.total_earnings}</div>
                      <div className="text-xs opacity-60 mt-1">Avg: R{r.avg_fare}</div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-6 gap-3 mt-4">
                    <div className="border rounded-xl p-3">
                      <div className="text-xs opacity-60">Completed</div>
                      <div className="font-semibold mt-1">{r.trips_completed}</div>
                    </div>

                    <div className="border rounded-xl p-3">
                      <div className="text-xs opacity-60">Cash trips</div>
                      <div className="font-semibold mt-1">{r.cash_trips}</div>
                    </div>

                    <div className="border rounded-xl p-3">
                      <div className="text-xs opacity-60">Cash total</div>
                      <div className="font-semibold mt-1">R{r.cash_total}</div>
                    </div>

                    <div className="border rounded-xl p-3">
                      <div className="text-xs opacity-60">In-progress</div>
                      <div className="font-semibold mt-1">{r.in_progress_trips}</div>
                    </div>

                    <div className="border rounded-xl p-3">
                      <div className="text-xs opacity-60">In-progress value</div>
                      <div className="font-semibold mt-1">R{r.in_progress_total}</div>
                    </div>

                    <div className="border rounded-xl p-3">
                      <div className="text-xs opacity-60">Breakdown</div>
                      <div className="text-xs mt-1 opacity-80">{statusBreakdown}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}