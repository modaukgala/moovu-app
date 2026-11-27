"use client";
import LoadingState from "@/components/ui/LoadingState";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";

type CompletedTrip = {
  id: string;
  driver_id: string | null;
  driver_name?: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  status: string | null;
  created_at: string | null;
  completed_at?: string | null;
  commission_amount?: number | null;
  driver_net_earnings?: number | null;
};

type AdminEarnings = {
  today_total: number;
  week_total: number;
  month_total: number;
  today_commission?: number;
  week_commission?: number;
  month_commission?: number;
  total_revenue: number;
  total_commission: number;
  estimated_driver_payout: number;
  commission_rate?: number;
  commission_rate_label?: string;
  total_completed_trips: number;
  by_payment_method: Record<
    string,
    number | { revenue: number; commission: number; count: number }
  >;
  recent_completed_trips: CompletedTrip[];
};

function money(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `R${n.toFixed(2)}`;
}

export default function AdminEarningsPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<AdminEarnings | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [driverId, setDriverId] = useState("");
  const [driverOptions, setDriverOptions] = useState<{ id: string; first_name: string | null; last_name: string | null }[]>([]);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }, []);

  const loadEarnings = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setMsg("You are not logged in.");
      setLoading(false);
      return;
    }

    const params = new URLSearchParams();
    if (from) params.set("from", new Date(`${from}T00:00:00+02:00`).toISOString());
    if (to) params.set("to", new Date(new Date(`${to}T00:00:00+02:00`).getTime() + 86400000).toISOString());
    if (driverId) params.set("driverId", driverId);
    const res = await fetch(`/api/admin/earnings?${params}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      setMsg("Admin earnings route is not returning JSON.");
      setLoading(false);
      return;
    }

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load admin earnings.");
      setLoading(false);
      return;
    }

    setEarnings(json.earnings ?? null);
    setLoading(false);
  }, [getAccessToken, from, to, driverId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const response = await fetch("/api/admin/drivers/options", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
      const json = await response.json().catch(() => null);
      if (active && response.ok && json?.ok) setDriverOptions(json.drivers ?? []);
    })();
    return () => { active = false; };
  }, [getAccessToken]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadEarnings();
    }, 0);

    return () => window.clearTimeout(initialLoad);
  }, [loadEarnings]);

  if (loading) {
    return <LoadingState title="Loading admin earnings..." />;
  }

  const methods = Object.entries(earnings?.by_payment_method ?? {}).map(([method, v]) => ({
    method, ...(typeof v === "number" ? { revenue: v, commission: 0, count: 0 } : v),
  }));

  return (
    <div className="ad-page moovu-admin-finance-page">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
      <header className="ad-head">
        <h1>Money overview</h1>
        <p>What customers paid for completed trips, what MOOVU earned in commission, and what drivers earned. Cancelled trips aren&apos;t counted.</p>
      </header>

      <section className="ad-card grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
        <label className="text-sm font-semibold">From<input type="date" className="mt-1 w-full rounded-xl border px-3 py-2" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-sm font-semibold">To<input type="date" className="mt-1 w-full rounded-xl border px-3 py-2" value={to} onChange={e => setTo(e.target.value)} /></label>
        <label className="text-sm font-semibold">Driver
          <select className="mt-1 w-full rounded-xl border px-3 py-2" value={driverId} onChange={e => setDriverId(e.target.value)}>
            <option value="">All drivers</option>
            {driverOptions.map(d => <option key={d.id} value={d.id}>{[d.first_name, d.last_name].filter(Boolean).join(" ") || "Driver"}</option>)}
          </select>
        </label>
        <button type="button" className="ad-btn" onClick={() => { setFrom(""); setTo(""); setDriverId(""); }}>Clear</button>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {([["Today", earnings?.today_total, earnings?.today_commission], ["This week", earnings?.week_total, earnings?.week_commission], ["This month", earnings?.month_total, earnings?.month_commission]] as const).map(([label, paid, commission]) => (
          <article key={label} className="ad-card">
            <p className="ad-note font-bold">{label}</p>
            <p className="mt-1 text-2xl font-black">{money(paid)}</p>
            <p className="ad-note">customers paid · MOOVU earned <b>{money(commission)}</b></p>
          </article>
        ))}
      </section>

      <section className="ad-card">
        <div className="ad-card-head"><h2>{from || to || driverId ? "In your filter" : "All time"}</h2><span className="ad-note">{earnings?.total_completed_trips ?? 0} completed trips</span></div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div><dt className="ad-note">Customers paid</dt><dd className="text-xl font-black">{money(earnings?.total_revenue)}</dd></div>
          <div><dt className="ad-note">MOOVU commission{earnings?.commission_rate_label ? ` (${earnings.commission_rate_label})` : ""}</dt><dd className="text-xl font-black">{money(earnings?.total_commission)}</dd></div>
          <div><dt className="ad-note">Drivers earned</dt><dd className="text-xl font-black">{money(earnings?.estimated_driver_payout)}</dd></div>
        </dl>
        {methods.length > 0 && (
          <div className="ad-rows mt-4">
            {methods.map(m => (
              <div key={m.method} className="ad-row">
                <div><div className="ad-row-title">{m.method === "online" ? "Card" : m.method === "cash" ? "Cash" : m.method}</div><div className="ad-row-sub">{m.count} trips · MOOVU earned {money(m.commission)}</div></div>
                <b>{money(m.revenue)}</b>
              </div>
            ))}
          </div>
        )}
        <p className="ad-note mt-3">On cash trips the driver keeps the money and owes MOOVU the commission and booking fee. On card trips MOOVU receives the money and pays the driver out. See the Driver earnings report in <Link className="underline" href="/admin/reports">Reports</Link>, <Link className="underline" href="/admin/online-payouts">Driver payouts</Link> and <Link className="underline" href="/admin/commission-payments">Commission payments</Link>.</p>
      </section>

      <section className="ad-card">
        <div className="ad-card-head"><h2>Latest completed trips</h2><Link href="/admin/trips">All trips →</Link></div>
        {(earnings?.recent_completed_trips ?? []).length === 0 ? <p className="ad-empty">No completed trips in this filter.</p> : (
          <div className="ad-rows">
            {(earnings?.recent_completed_trips ?? []).slice(0, 25).map(t => (
              <Link key={t.id} href={`/admin/trips/${t.id}`} className="ad-row">
                <div className="min-w-0">
                  <div className="ad-row-title">{t.driver_name ?? "Driver"} · {t.payment_method === "online" ? "card" : "cash"}</div>
                  <div className="ad-row-sub">{t.pickup_address} → {t.dropoff_address}</div>
                  <div className="ad-row-sub">{t.completed_at ? new Date(t.completed_at).toLocaleString("en-ZA") : ""} · commission {money(t.commission_amount)} · driver {money(t.driver_net_earnings)}</div>
                </div>
                <b>{money(t.fare_amount)}</b>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
