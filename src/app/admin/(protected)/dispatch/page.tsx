"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { waLinkZA } from "@/lib/whatsapp";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import TripDispatchActions from "@/components/admin/TripDispatchActions";
import { LIVE_LOCATION_CONFIG } from "@/lib/location/liveLocationConfig";
import { supabaseClient } from "@/lib/supabase/client";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import { useReliableRead, useReadLoop } from "@/hooks/useReliableRead";
import { READ_POLICIES, readFailure } from "@/lib/reliability/readPolling";

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
  dispatch_started_at?: string | null;
  dispatch_cycle?: number | null;
  dispatch_sequence?: number | null;
  dispatch_state?: string | null;
  dispatch_search_radius_km?: number | null;
  dispatch_failure_reason?: string | null;
  offers?: Array<{
    id: string; driver_id: string; status: string; offered_at: string | null;
    responded_at: string | null; expired_at: string | null; accept_deadline_at: string | null;
    decline_reason: string | null; response_source: string | null;
  }>;
  driver: {
    id: string;
    name: string;
    phone: string | null;
    online: boolean | null;
    busy: boolean | null;
    subscription_status: string | null;
    last_seen: string | null;
  } | null;
};

function groupKey(status: string) {
  if (status === "requested") return "requested";
  if (status === "offered") return "offered";
  if (status === "assigned" || status === "arrived" || status === "ongoing" || status === "scheduled") return "active";
  return "closed";
}

function money(value: number | null | undefined) {
  return value == null ? "--" : `R${Number(value).toFixed(2)}`;
}

export default function DispatchBoardPage() {
  const [openPage, setOpenPage] = useState(1);
  const [closedPage, setClosedPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status] = useState("all");
  const [pagination, setPagination] = useState<{ openTripsTotal: number | null; closedTripsTotal: number | null; openTripsVisible: number; closedTripsVisible: number } | null>(null);
  const [rows, setRows] = useState<BoardTrip[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [retrievalWarning, setRetrievalWarning] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const refreshDebounceRef = useRef<number | null>(null);
  const isPageVisible = usePageVisibility();
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const boardRead = useReliableRead(READ_POLICIES.adminBoard, "admin-board", realtimeConnected, `${openPage}:${closedPage}:${search}:${status}`);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }, []);

  const loadBoard = useCallback(() => boardRead.run(async (signal) => {
    const token = await getAccessToken();

    if (!token) {
      setMsg("Missing access token.");
      setRows([]);
      setPagination(null);
      return readFailure(401);
    }

    const res = await fetch(`/api/admin/dispatch/board?${new URLSearchParams({ openPage: String(openPage), closedPage: String(closedPage), q: search, status })}`, {
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    signal.throwIfAborted();

    if (!res?.ok || !json?.ok || !Array.isArray(json.rows)) {
      setMsg(json?.error || "Failed to load dispatch board");
      setRows([]);
      setPagination(null);
      return readFailure(res?.status ?? 503);
    }

    setMsg(null);
    setRows(json.rows ?? []);
    setPagination(json.retrieval ?? null);
    setRetrievalWarning(json.retrieval?.warning ?? null);
  }), [getAccessToken, boardRead, openPage, closedPage, search, status]);

  useReadLoop(boardRead, loadBoard);

  useEffect(() => {
    const t = setInterval(() => {
      setNowMs(Date.now());
    }, LIVE_LOCATION_CONFIG.adminDispatchBoardRefreshMs);
    return () => clearInterval(t);
  }, [loadBoard]);

  useEffect(() => {
    const channel = supabaseClient
      .channel("admin-dispatch-board-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => {
        if (!isPageVisible || refreshDebounceRef.current != null) return;
        refreshDebounceRef.current = window.setTimeout(() => {
          refreshDebounceRef.current = null;
          void loadBoard();
        }, 1200);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => {
        if (!isPageVisible || refreshDebounceRef.current != null) return;
        refreshDebounceRef.current = window.setTimeout(() => {
          refreshDebounceRef.current = null;
          void loadBoard();
        }, 1200);
      })
      .subscribe((status) => setRealtimeConnected(status === "SUBSCRIBED"));

    return () => {
      if (refreshDebounceRef.current != null) {
        window.clearTimeout(refreshDebounceRef.current);
        refreshDebounceRef.current = null;
      }
      void supabaseClient.removeChannel(channel);
    };
  }, [isPageVisible, loadBoard]);

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

  function secondsLeft(expiresAt: string | null) {
    if (!expiresAt) return null;
    return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - nowMs) / 1000));
  }

  function waitingFor(iso: string) {
    const mins = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60000));
    return mins < 1 ? "just now" : `${mins} min`;
  }

  /** One line per trip that says, in plain words, what is happening and what you can do. */
  function renderTripRow(trip: BoardTrip) {
    const left = secondsLeft(trip.offer_expires_at);
    const noDriver = !trip.driver_id && (trip.status === "requested" || trip.status === "offered");
    const story = ({
      requested: trip.attempted_count > 0
        ? `No driver yet — offered to ${trip.attempted_count} driver${trip.attempted_count === 1 ? "" : "s"}, none accepted.`
        : "Looking for a driver.",
      offered: `Offered to a driver${left != null ? ` · ${left}s left to accept` : ""} · ${trip.attempted_count} tried so far.`,
      assigned: `${trip.driver?.name ?? "Driver"} is on the way to the pickup.`,
      arrived: `${trip.driver?.name ?? "Driver"} is waiting at the pickup.`,
      ongoing: `${trip.driver?.name ?? "Driver"} is driving the customer.`,
      scheduled: "Scheduled ride.",
      completed: `Completed by ${trip.driver?.name ?? "driver"}.`,
      cancelled: `Cancelled${trip.cancel_reason ? `: ${trip.cancel_reason}` : ""}.`,
    } as Record<string, string>)[trip.status] ?? trip.status;
    return (
      <article key={trip.id} className="ad-row">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ad-row-title">{trip.pickup_address}</span>
            <span className="ad-note">→ {trip.dropoff_address}</span>
          </div>
          <div className="ad-row-sub">{story}</div>
          <div className="ad-row-sub">{money(trip.fare_amount)} {trip.payment_method === "online" ? "card" : "cash"} · requested {waitingFor(trip.created_at)} ago
            {trip.dispatch_failure_reason && noDriver ? ` · ${trip.dispatch_failure_reason}` : ""}</div>
        </div>
        <div className="ad-row-actions">
          {noDriver && <TripDispatchActions tripId={trip.id} onDone={(m) => { setMsg(m); void loadBoard(); }} />}
          {trip.status === "offered" && trip.driver?.phone && <button type="button" className="ad-btn" onClick={() => openWhatsAppOffer(trip)}>WhatsApp driver</button>}
          {trip.status === "offered" && <button type="button" className="ad-btn" disabled={busyId === trip.id} onClick={() => offerNext(trip.id)}>Next driver</button>}
          {trip.driver?.phone && trip.status !== "offered" && <a className="ad-btn" href={`tel:${trip.driver.phone}`}>Call driver</a>}
          <Link href={`/admin/trips/${trip.id}`} className="ad-btn">Open</Link>
        </div>
      </article>
    );
  }

  const lanes = [
    { key: "waiting", title: "Needs a driver", hint: "Customers waiting — assign or re-offer.", rows: [...grouped.requested, ...grouped.offered], tone: "is-waiting" },
    { key: "pickup", title: "Going to pickup", hint: "Driver accepted and is on the way, or has arrived.", rows: grouped.active.filter(t => t.status === "assigned" || t.status === "arrived"), tone: "is-live" },
    { key: "trip", title: "On a trip", hint: "Customer is in the car.", rows: grouped.active.filter(t => t.status === "ongoing"), tone: "is-live" },
    { key: "scheduled", title: "Scheduled", hint: "Booked for later.", rows: grouped.active.filter(t => t.status === "scheduled"), tone: "" },
  ];

  return (
    <div className="ad-page">
      {msg && <CenteredMessageBox title="Dispatch" message={msg} onClose={() => setMsg(null)} />}
      <header className="ad-head flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Dispatch board</h1>
          <p>What is happening right now. Updates live{realtimeConnected ? "" : " (reconnecting…)"}.</p>
        </div>
        <Link href="/admin/dispatch/map" className="ad-btn">Open map</Link>
      </header>

      <section className="ad-stats" aria-label="Right now">
        {lanes.map(l => (
          <a key={l.key} href={`#lane-${l.key}`} className={`ad-stat${l.key === "waiting" && l.rows.length > 0 ? " is-attention" : ""}`}>
            <small>{l.title}</small><strong>{l.rows.length}</strong>
          </a>
        ))}
      </section>

      <input type="search" className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3" placeholder="Search pickup, drop-off or trip ID"
        value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { setSearch(query.trim()); setOpenPage(1); setClosedPage(1); } }}
        onBlur={() => { if (query.trim() !== search) { setSearch(query.trim()); setOpenPage(1); setClosedPage(1); } }} aria-label="Search dispatch" />
      {retrievalWarning && <p className="ad-note">{retrievalWarning}</p>}

      {lanes.map(l => (
        <section key={l.key} id={`lane-${l.key}`} className="ad-card">
          <div className="ad-card-head">
            <div><h2>{l.title} <span className={`ad-badge ${l.tone}`}>{l.rows.length}</span></h2><p className="ad-note">{l.hint}</p></div>
          </div>
          {l.rows.length === 0 ? <p className="ad-empty">Nothing here right now.</p> : <div className="ad-rows">{l.rows.map(renderTripRow)}</div>}
        </section>
      ))}

      <details className="ad-card">
        <summary className="cursor-pointer font-black">Recently finished ({pagination?.closedTripsTotal ?? grouped.closed.length})</summary>
        <div className="ad-rows mt-3">{grouped.closed.map(renderTripRow)}</div>
        <div className="mt-3 flex items-center justify-between">
          <button type="button" className="ad-btn" disabled={closedPage <= 1} onClick={() => setClosedPage(p => p - 1)}>Newer</button>
          <span className="ad-note">Page {closedPage}</span>
          <button type="button" className="ad-btn" disabled={(pagination?.closedTripsVisible ?? 0) < 50} onClick={() => setClosedPage(p => p + 1)}>Older</button>
        </div>
      </details>
    </div>
  );
}
