"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";

type ReportRow = {
  id: string;
  driver_id: string | null;
  driver_name?: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  status: string | null;
  created_at: string | null;
  commission_amount?: number | null;
  driver_net_earnings?: number | null;
};

type ReportResponse = {
  completed: ReportRow[];
  inProgress: ReportRow[];
  totals: {
    completedTrips: number;
    completedRevenue: number;
    completedCommission: number;
    completedDriverNet: number;
    inProgressTrips: number;
    inProgressValue: number;
    lateCancellationFees?: number;
    noShowFees?: number;
    cancellationDriverPayouts?: number;
    cancellationMoovuRevenue?: number;
  };
  byDriver: Array<{
    driver_id: string;
    driver_name: string;
    completed_trips: number;
    completed_revenue: number;
    completed_commission: number;
    completed_driver_net: number;
    cancellation_driver_payouts?: number;
  }>;
};

function money(v: number | null | undefined) {
  return `R${Number(v ?? 0).toFixed(2)}`;
}

function todayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function weekAgoIso() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function AdminReportsPage() {
  const [from, setFrom] = useState(weekAgoIso());
  const [to, setTo] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [data, setData] = useState<ReportResponse | null>(null);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    return session?.access_token ?? null;
  }, []);

  const runReport = useCallback(async () => {
    setBusy(true);
    setMsg(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setMsg("Missing access token.");
        setBusy(false);
        return;
      }

      const url = `/api/admin/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setMsg(json?.error || "Failed to load report.");
        setBusy(false);
        return;
      }

      setData(json.report ?? null);
    } catch (error: unknown) {
      setMsg(error instanceof Error ? error.message : "Failed to load report.");
    }

    setBusy(false);
  }, [from, getAccessToken, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runReport();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [runReport]);

  const totals = useMemo(() => {
    return (
      data?.totals ?? {
        completedTrips: 0,
        completedRevenue: 0,
        completedCommission: 0,
        completedDriverNet: 0,
        inProgressTrips: 0,
        inProgressValue: 0,
        lateCancellationFees: 0,
        noShowFees: 0,
        cancellationDriverPayouts: 0,
        cancellationMoovuRevenue: 0,
      }
    );
  }, [data]);

  return (
    <main className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Driver Earnings Report</h1>
        <p className="opacity-70 mt-1">
          Completed trips use normal 9.5% MOOVU commission. Cancellation and no-show fees are fixed split payouts, not commission debt.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="date"
          className="border rounded-xl px-4 py-2"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          className="border rounded-xl px-4 py-2"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <button
          className="border rounded-xl px-4 py-2"
          disabled={busy}
          onClick={runReport}
        >
          {busy ? "Running..." : "Run"}
        </button>
      </div>

      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <section className="border rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold">Totals</h2>

        <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">Completed trips</div>
            <div className="text-2xl font-semibold mt-2">{totals.completedTrips}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">Total earnings (completed)</div>
            <div className="text-2xl font-semibold mt-2">{money(totals.completedRevenue)}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">MOOVU commission</div>
            <div className="text-2xl font-semibold mt-2">{money(totals.completedCommission)}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">Driver net</div>
            <div className="text-2xl font-semibold mt-2">{money(totals.completedDriverNet)}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">In-progress trips</div>
            <div className="text-2xl font-semibold mt-2">{totals.inProgressTrips}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">In-progress value</div>
            <div className="text-2xl font-semibold mt-2">{money(totals.inProgressValue)}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">Late cancel fees</div>
            <div className="text-2xl font-semibold mt-2">{money(totals.lateCancellationFees)}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">No-show fees</div>
            <div className="text-2xl font-semibold mt-2">{money(totals.noShowFees)}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">Driver fee payouts</div>
            <div className="text-2xl font-semibold mt-2">{money(totals.cancellationDriverPayouts)}</div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="text-sm opacity-70">MOOVU fee revenue</div>
            <div className="text-2xl font-semibold mt-2">{money(totals.cancellationMoovuRevenue)}</div>
          </div>
        </div>
      </section>

      <section className="border rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold">By Driver</h2>

        {!data?.byDriver?.length ? (
          <div className="opacity-70">No data.</div>
        ) : (
          <div className="space-y-3">
            {data.byDriver.map((row) => (
              <div key={row.driver_id} className="border rounded-xl p-4">
                <div className="font-medium">{row.driver_name}</div>
                <div className="text-xs opacity-60 mt-1">{row.driver_id}</div>
                <div className="text-sm opacity-70 mt-2">
                  Trips: {row.completed_trips} - Revenue: {money(row.completed_revenue)} - Commission: {money(row.completed_commission)} - Driver Net: {money(row.completed_driver_net)} - Fee Payouts: {money(row.cancellation_driver_payouts)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
