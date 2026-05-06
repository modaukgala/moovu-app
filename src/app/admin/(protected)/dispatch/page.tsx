"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { waLinkZA } from "@/lib/whatsapp";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";

type BoardTrip = {
  id: string;
  driver_id: string | null;
  pickup_address: string;
  dropoff_address: string;
  fare_amount: number | null;
  payment_method: string | null;
  status: string;
  cancel_reason: string | null;
  created_at: string;
  offer_status: string | null;
  offer_expires_at: string | null;
  offer_attempted_driver_ids: string[] | null;
  attempted_count: number;
  driver: {
    id: string;
    name: string;
    phone: string | null;
    online: boolean | null;
    busy: boolean | null;
    subscription_status: string | null;
  } | null;
};

function groupKey(status: string) {
  if (status === "requested") return "requested";
  if (status === "offered") return "offered";
  if (status === "assigned" || status === "arrived" || status === "ongoing") return "active";
  return "closed";
}

function money(value: number | null | undefined) {
  return value == null ? "--" : `R${Number(value).toFixed(2)}`;
}

export default function DispatchBoardPage() {
  const [rows, setRows] = useState<BoardTrip[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }, []);

  const loadBoard = useCallback(async () => {
    const token = await getAccessToken();

    if (!token) {
      setMsg("Missing access token.");
      setRows([]);
      return;
    }

    const res = await fetch("/api/admin/dispatch/board", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const json = await res.json();

    if (!json.ok) {
      setMsg(json.error || "Failed to load dispatch board");
      setRows([]);
      return;
    }

    setMsg(null);
    setRows(json.rows ?? []);
  }, [getAccessToken]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadBoard();
    }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadBoard]);

  useEffect(() => {
    const t = setInterval(() => {
      setNowMs(Date.now());
      void loadBoard();
    }, 3000);
    return () => clearInterval(t);
  }, [loadBoard]);

  async function offerNext(tripId: string) {
    setBusyId(tripId);
    setMsg(null);

    const token = await getAccessToken();

    if (!token) {
      setBusyId(null);
      setMsg("Missing access token.");
      return;
    }

    const res = await fetch("/api/admin/trips/auto-assign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tripId }),
    });

    const json = await res.json();
    setBusyId(null);

    if (!json.ok) {
      setMsg(json.error || "Failed to offer next driver");
      return;
    }

    await loadBoard();
  }

  async function openWhatsAppOffer(trip: BoardTrip) {
    if (!trip.driver?.phone) {
      setMsg("Driver phone missing");
      return;
    }

    const expires = trip.offer_expires_at
      ? new Date(trip.offer_expires_at).toLocaleTimeString()
      : null;

    const message =
      `MOOVU TRIP OFFER\n` +
      `Hi ${trip.driver.name}, you have a trip offer.\n\n` +
      `Trip ID: ${trip.id}\n` +
      `Pickup: ${trip.pickup_address}\n` +
      `Dropoff: ${trip.dropoff_address}\n` +
      `Fare: ${money(trip.fare_amount)}\n` +
      `Status: ${trip.status} (${trip.offer_status ?? "--"})\n` +
      (expires ? `Expires at: ${expires}\n` : "") +
      `\nLogin to accept/reject:\nhttps://moovurides.co.za/driver/login`;

    const href = waLinkZA(trip.driver.phone, message);
    if (!href) {
      setMsg("Invalid WhatsApp number");
      return;
    }

    window.open(href, "_blank", "noopener,noreferrer");
  }

  const grouped = useMemo(() => {
    const g = {
      requested: [] as BoardTrip[],
      offered: [] as BoardTrip[],
      active: [] as BoardTrip[],
      closed: [] as BoardTrip[],
    };

    for (const row of rows) {
      g[groupKey(row.status) as keyof typeof g].push(row);
    }

    return g;
  }, [rows]);

  const stats = useMemo(
    () => ({
      requested: grouped.requested.length,
      offered: grouped.offered.length,
      active: grouped.active.length,
      closed: grouped.closed.length,
    }),
    [grouped],
  );

  function secondsLeft(expiresAt: string | null) {
    if (!expiresAt) return null;
    return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - nowMs) / 1000));
  }

  function renderTripCard(trip: BoardTrip) {
    const left = secondsLeft(trip.offer_expires_at);

    return (
      <article key={trip.id} className="moovu-dispatch-card space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              Trip {trip.id.slice(0, 8)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={trip.status} />
              {trip.offer_status ? <StatusBadge status={trip.offer_status} /> : null}
            </div>
          </div>

          <div className="rounded-2xl bg-[var(--moovu-primary-soft)] px-3 py-2 text-right">
            <div className="text-xs text-slate-500">Fare</div>
            <div className="font-black text-slate-950">{money(trip.fare_amount)}</div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="moovu-route-line">
            <div className="moovu-route-line-marker" />
            <div>
              <div className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">Pickup</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">{trip.pickup_address}</div>
            </div>
          </div>
          <div className="moovu-route-line">
            <div className="moovu-route-line-marker" />
            <div>
              <div className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">Dropoff</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">{trip.dropoff_address}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Payment</div>
            <div className="mt-1 font-bold text-slate-950">{trip.payment_method ?? "--"}</div>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Attempts</div>
            <div className="mt-1 font-bold text-slate-950">{trip.attempted_count}</div>
          </div>
        </div>

        {left != null ? (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-black text-blue-800">
            Offer timer: {left}s
          </div>
        ) : null}

        <div className="rounded-2xl border border-[var(--moovu-border)] bg-white p-3 text-sm">
          <div className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">Driver</div>
          <div className="mt-1 font-bold text-slate-950">
            {trip.driver
              ? `${trip.driver.name}${trip.driver.phone ? ` (${trip.driver.phone})` : ""}`
              : "Unassigned"}
          </div>
          {trip.driver ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
              <span>{trip.driver.online ? "online" : "offline"}</span>
              <span>{trip.driver.busy ? "busy" : "free"}</span>
              <span>{trip.driver.subscription_status ?? "no subscription"}</span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {(trip.status === "requested" || trip.status === "offered") && (
            <button
              className="moovu-btn moovu-btn-primary"
              disabled={busyId === trip.id}
              onClick={() => offerNext(trip.id)}
            >
              {busyId === trip.id ? "Working..." : "Offer next"}
            </button>
          )}

          {trip.driver && (trip.status === "offered" || trip.status === "assigned") && (
            <button
              className="moovu-btn moovu-btn-secondary"
              onClick={() => openWhatsAppOffer(trip)}
            >
              WhatsApp driver
            </button>
          )}

          <Link className="moovu-btn moovu-btn-secondary" href={`/admin/trips/${trip.id}`}>
            Open trip
          </Link>
        </div>

        {trip.cancel_reason && (
          <div className="rounded-2xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            Cancel reason: {trip.cancel_reason}
          </div>
        )}
      </article>
    );
  }

  function renderColumn(title: string, items: BoardTrip[], tone: "primary" | "warning" | "success" | "default") {
    return (
      <section className="moovu-dispatch-column">
        <div className="flex items-center justify-between gap-2 px-1">
          <div>
            <h2 className="text-lg font-black text-slate-950">{title}</h2>
            <p className="mt-1 text-xs text-slate-500">Live queue</p>
          </div>
          <div className={`moovu-app-metric-${tone} rounded-2xl px-3 py-2 text-sm font-black`}>
            {items.length}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {items.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[var(--moovu-border)] bg-white/70 p-5 text-sm text-slate-500">
              No trips in this lane.
            </div>
          ) : (
            items.map(renderTripCard)
          )}
        </div>
      </section>
    );
  }

  return (
    <main className="space-y-6 text-black">
      <section className="moovu-hero-panel p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-white/70">
              Dispatch board
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">
              Move every request through the right lane.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/74">
              Requested, offered, active, and closed trips refresh automatically so operators can act quickly.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/admin/dispatch/map" className="moovu-btn bg-white text-slate-950">
              Open live map
            </Link>
            <button className="moovu-btn bg-white/12 text-white ring-1 ring-white/22" onClick={loadBoard}>
              Refresh
            </button>
          </div>
        </div>
      </section>

      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <section className="grid gap-3 md:grid-cols-4">
        <div className="moovu-stat-card">
          <div className="moovu-stat-label">Requested</div>
          <div className="moovu-stat-value">{stats.requested}</div>
        </div>
        <div className="moovu-stat-card moovu-stat-card-primary">
          <div className="moovu-stat-label">Offered</div>
          <div className="moovu-stat-value">{stats.offered}</div>
        </div>
        <div className="moovu-stat-card">
          <div className="moovu-stat-label">Active</div>
          <div className="moovu-stat-value">{stats.active}</div>
        </div>
        <div className="moovu-stat-card">
          <div className="moovu-stat-label">Closed</div>
          <div className="moovu-stat-value">{stats.closed}</div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
        {renderColumn("Requested", grouped.requested, "primary")}
        {renderColumn("Offered", grouped.offered, "warning")}
        {renderColumn("Active", grouped.active, "success")}
        {renderColumn("Closed", grouped.closed, "default")}
      </div>
    </main>
  );
}
