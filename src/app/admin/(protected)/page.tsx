"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminSearch from "@/components/admin/AdminSearch";
import TripDispatchActions from "@/components/admin/TripDispatchActions";
import { supabaseClient } from "@/lib/supabase/client";

type RecentTrip = {
  id: string; rider_name: string | null; rider_phone: string | null; pickup_address: string | null;
  dropoff_address: string | null; status: string; driver_id: string | null; driver_name: string | null;
  driver_phone: string | null; payment_method: string | null; fare_amount: number | string | null;
  created_at: string; scheduled_for: string | null; offer_status: string | null;
};

type HomeData = {
  recent: RecentTrip[];
  live: { onlineDrivers: number | null; liveTrips: number | null };
  needsYou: { payouts: number | null; refunds: number | null; applications: number | null };
};

const STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: "Looking for a driver", tone: "is-waiting" },
  offered: { label: "Offered to a driver", tone: "is-waiting" },
  assigned: { label: "Driver on the way", tone: "is-live" },
  arrived: { label: "Driver arrived", tone: "is-live" },
  ongoing: { label: "On trip", tone: "is-live" },
  completed: { label: "Completed", tone: "is-done" },
  cancelled: { label: "Cancelled", tone: "is-off" },
  scheduled: { label: "Scheduled", tone: "" },
};

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
};

const rand = (value: number | string | null) => `R${Number(value ?? 0).toFixed(0)}`;
const needsDriver = (trip: RecentTrip) => !trip.driver_id && (trip.status === "requested" || trip.status === "offered");

export default function AdminHomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadHome = useCallback(async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch("/api/admin/home", { cache: "no-store", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (json?.ok) { setData(json); setError(null); } else setError(json?.error ?? "Couldn't load the latest trips.");
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void loadHome(), 0);
    const timer = window.setInterval(() => { if (!document.hidden) void loadHome(); }, 15000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [loadHome]);

  const needs = data?.needsYou;
  const attention = [
    { href: "/admin/online-payouts", label: "Payout requests", value: needs?.payouts },
    { href: "/admin/refunds", label: "Refund requests", value: needs?.refunds },
    { href: "/admin/onboarding", label: "Driver applications", value: needs?.applications },
  ];

  return (
    <div className="ad-page">
      <header className="ad-head">
        <h1>Home</h1>
        <p>Find anyone fast, and see the latest ride requests as they come in.</p>
      </header>

      <AdminSearch />

      <section className="ad-stats" aria-label="Right now">
        <Link href="/admin/dispatch" className="ad-stat"><small>Trips happening now</small><strong>{data?.live.liveTrips ?? "–"}</strong></Link>
        <Link href="/admin/dispatch/map" className="ad-stat"><small>Drivers online</small><strong>{data?.live.onlineDrivers ?? "–"}</strong></Link>
        {attention.map(item => (
          <Link key={item.href} href={item.href} className={`ad-stat${(item.value ?? 0) > 0 ? " is-attention" : ""}`}>
            <small>{item.label}</small><strong>{item.value ?? "–"}</strong>
          </Link>
        ))}
      </section>

      <section className="ad-card" aria-label="Latest ride requests">
        <div className="ad-card-head">
          <h2>Latest ride requests</h2>
          <Link href="/admin/trips">All trips →</Link>
        </div>
        {notice && <p className="ad-note mb-3 font-semibold text-slate-800" role="status">{notice}</p>}
        {error && <p className="ad-empty">{error}</p>}
        {!data && !error && <p className="ad-empty">Loading…</p>}
        {data && data.recent.length === 0 && <p className="ad-empty">No ride requests yet.</p>}
        <div className="ad-rows">
          {data?.recent.map(trip => {
            const status = STATUS[trip.status] ?? { label: trip.status, tone: "" };
            return (
              <article key={trip.id} className="ad-row">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="ad-row-title">{trip.rider_name || "Customer"}</span>
                    <span className={`ad-badge ${status.tone}`}>{status.label}</span>
                  </div>
                  <div className="ad-row-sub">{trip.pickup_address ?? "Pickup"} → {trip.dropoff_address ?? "Drop-off"}</div>
                  <div className="ad-row-sub">
                    {ago(trip.created_at)} · {rand(trip.fare_amount)} {trip.payment_method === "online" ? "card" : "cash"}
                    {trip.rider_phone ? ` · ${trip.rider_phone}` : ""}
                    {trip.driver_name ? ` · Driver: ${trip.driver_name}` : needsDriver(trip) ? " · No driver yet" : ""}
                  </div>
                </div>
                <div className="ad-row-actions">
                  {needsDriver(trip) && <TripDispatchActions tripId={trip.id} onDone={message => { setNotice(message); void loadHome(); }} />}
                  <Link href={`/admin/trips/${trip.id}`} className="ad-btn">Open</Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
