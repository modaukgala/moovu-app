"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TripDispatchActions from "@/components/admin/TripDispatchActions";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import LoadingState from "@/components/ui/LoadingState";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";
import { adminDriverName } from "@/lib/admin/identity";

type Trip = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string;
  dropoff_address: string;
  payment_method: string;
  fare_amount: number | null;
  status: string;
  created_at: string;
  driver_id: string | null;
  driver_name?: string | null;
  stops?: unknown;
  original_fare?: number | null;
  final_add_stop_increase?: number | null;
  final_fare?: number | null;
  stop_waiting_fee?: number | null;
};

type TripStop = {
  address: string;
};

type Driver = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  status: string;
};

const STATUSES = [
  "not cancelled",
  "requested",
  "assigned",
  "arrived",
  "ongoing",
  "completed",
  "cancelled",
  "all",
] as const;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function money(value: number | null | undefined) {
  return value == null ? "--" : `R${Number(value).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function parseTripStops(value: unknown): TripStop[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 2)
    .map((stop) => {
      const item = (stop ?? {}) as { address?: unknown };
      return { address: typeof item.address === "string" ? item.address : "" };
    })
    .filter((stop) => stop.address.trim());
}

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("not cancelled");
  const [search, setSearch] = useState("");
  const [pageError, setPageError] = useState<string | null>(null);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    return session?.access_token ?? null;
  }, []);

  const loadDrivers = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setDrivers([]);
      setPageError("Please sign in as an admin to load drivers.");
      return;
    }

    const res = await fetch("/api/admin/drivers/options", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setDrivers([]);
      setPageError(json?.error || "Could not load drivers. Please refresh or contact admin support.");
      return;
    }

    const rows = ((json.drivers ?? []) as Driver[]).filter((driver) =>
      ["approved", "active"].includes(driver.status)
    );
    setDrivers(rows);
  }, [getAccessToken]);

  const loadTrips = useCallback(async (currentStatus: string, background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setPageError(null);

    const token = await getAccessToken();
    if (!token) {
      setPageError("Please sign in as an admin to load trips.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const res = await fetch("/api/admin/trips/list", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setPageError(json?.error || "Could not load trips. Please refresh or contact admin support.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const rows = (json.trips ?? []) as Trip[];
    // Cancelled trips are hidden unless asked for, so they don't clutter the list or inflate totals.
    setTrips(
      currentStatus === "all" ? rows
        : currentStatus === "not cancelled" ? rows.filter((trip) => trip.status !== "cancelled")
        : rows.filter((trip) => trip.status === currentStatus),
    );
    setLastUpdatedAt(new Date());
    setLoading(false);
    setRefreshing(false);
  }, [getAccessToken]);

  useEffect(() => {
    void loadDrivers();
    void loadTrips(status);
  }, [loadDrivers, loadTrips, status]);

  const driverNameById = useMemo(() => {
    const map = new Map<string, string>();
    drivers.forEach((d) => {
      map.set(d.id, adminDriverName(d));
    });
    return map;
  }, [drivers]);

  const refreshTrips = useCallback(async () => {
    await loadTrips(status, true);
  }, [loadTrips, status]);

  const tripStats = useMemo(
    () => ({
      total: trips.length,
      active: trips.filter((trip) => ["assigned", "arrived", "ongoing"].includes(trip.status)).length,
      requested: trips.filter((trip) => trip.status === "requested").length,
      revenue: trips.filter((trip) => trip.status === "completed").reduce((sum, trip) => sum + Number(trip.fare_amount ?? 0), 0),
    }),
    [trips],
  );
  const visibleTrips = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return trips;
    return trips.filter((trip) => [
      trip.id, trip.rider_name, trip.rider_phone, trip.driver_name,
      trip.pickup_address, trip.dropoff_address,
    ].some((value) => String(value ?? "").toLocaleLowerCase().includes(needle)));
  }, [search, trips]);

  async function cancelTrip(tripId: string) {
    setActionLoadingId(tripId);
    setPageError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setPageError("You are not logged in.");
        return;
      }

      const res = await fetch("/api/admin/trips/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tripId,
          reason: "Cancelled by admin from trips list",
        }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setPageError(json?.error || "Failed to cancel trip.");
        return;
      }

      await loadTrips(status);
    } catch (error: unknown) {
      setPageError(errorMessage(error, "Failed to cancel trip."));
    } finally {
      setActionLoadingId(null);
    }
  }

  async function markArrived(tripId: string) {
    setActionLoadingId(tripId);
    setPageError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setPageError("Please sign in as an admin to update trips.");
        return;
      }

      const res = await fetch(`/api/admin/trips/${encodeURIComponent(tripId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: "arrived" }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setPageError(json?.error || "Could not update trip. Please try again.");
        return;
      }

      await loadTrips(status);
    } finally {
      setActionLoadingId(null);
    }
  }

  if (loading) {
    return (
      <LoadingState
        title="Loading trips"
        description="Preparing trip movement, driver assignment, and dispatch actions."
      />
    );
  }

  const STATUS_TEXT: Record<string, string> = {
    "not cancelled": "All except cancelled", requested: "Needs driver", assigned: "Driver on way", arrived: "At pickup",
    ongoing: "On trip", completed: "Completed", cancelled: "Cancelled", all: "Everything",
  };

  return (
    <div className="ad-page">
      {pageError && <CenteredMessageBox title="Trips" message={pageError} onClose={() => setPageError(null)} />}
      <header className="ad-head flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Trips</h1>
          <p>{visibleTrips.length} trip{visibleTrips.length === 1 ? "" : "s"} shown{lastUpdatedAt ? ` · updated ${lastUpdatedAt.toLocaleTimeString("en-ZA")}` : ""}. Cancelled trips are hidden unless you pick them.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="ad-btn" disabled={refreshing} onClick={() => void refreshTrips()}>{refreshing ? "Refreshing…" : "Refresh"}</button>
          <Link className="ad-btn is-primary" href="/admin/trips/new">New trip</Link>
        </div>
      </header>

      <section className="ad-stats" aria-label="Summary">
        <div className="ad-stat"><small>Needs a driver</small><strong>{tripStats.requested}</strong></div>
        <div className="ad-stat"><small>Moving now</small><strong>{tripStats.active}</strong></div>
        <div className="ad-stat"><small>Completed fares</small><strong>{money(tripStats.revenue)}</strong></div>
      </section>

      <section className="ad-card space-y-3">
        <input id="admin-trip-search" type="search" className="w-full rounded-xl border border-slate-200 px-4 py-3" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search customer, phone, driver or address" aria-label="Search trips" />
        <div className="ad-tabs" aria-label="Trip status filters">
          {STATUSES.map(s => (
            <button key={s} type="button" className={status === s ? "is-on" : ""} onClick={() => setStatus(s)}>{STATUS_TEXT[s] ?? s}</button>
          ))}
        </div>
      </section>

      <section className="ad-card">
        {visibleTrips.length === 0 ? <p className="ad-empty">No trips match this filter.</p> : (
          <div className="ad-rows">
            {visibleTrips.map(trip => {
              const noDriver = !trip.driver_id && (trip.status === "requested" || trip.status === "offered");
              return (
                <article key={trip.id} className="ad-row">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/trips/${trip.id}`} className="ad-row-title hover:underline">{trip.rider_name ?? "Customer"}</Link>
                      <StatusBadge status={trip.status} />
                      <span className="ad-note">{money(trip.fare_amount)} {trip.payment_method === "online" ? "card" : "cash"}</span>
                    </div>
                    <div className="ad-row-sub">{trip.pickup_address}{parseTripStops(trip.stops).map(stop => ` → ${stop.address}`).join("")} → {trip.dropoff_address}</div>
                    <div className="ad-row-sub">{displayDate(trip.created_at)}{trip.rider_phone ? ` · ${trip.rider_phone}` : ""} · {trip.driver_id ? `Driver: ${trip.driver_name ?? driverNameById.get(trip.driver_id) ?? "unknown"}` : "No driver"}</div>
                  </div>
                  <div className="ad-row-actions">
                    {noDriver && <TripDispatchActions tripId={trip.id} onDone={m => { setPageError(m); void loadTrips(status, true); }} />}
                    {trip.status === "assigned" && <button type="button" className="ad-btn" disabled={actionLoadingId === trip.id} onClick={() => void markArrived(trip.id)}>Mark arrived</button>}
                    {trip.status !== "completed" && trip.status !== "cancelled" && <button type="button" className="ad-btn" style={{ color: "#b91c1c" }} disabled={actionLoadingId === trip.id} onClick={() => void cancelTrip(trip.id)}>Cancel</button>}
                    <Link className="ad-btn" href={`/admin/trips/${trip.id}`}>Open</Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
