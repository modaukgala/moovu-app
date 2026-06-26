"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";

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
  "all",
  "requested",
  "assigned",
  "arrived",
  "ongoing",
  "completed",
  "cancelled",
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

function AdminTripMobileField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`admin-trip-mobile-field ${className}`}>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
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

  const loadTrips = useCallback(async (currentStatus: string) => {
    setLoading(true);
    setPageError(null);

    const token = await getAccessToken();
    if (!token) {
      setTrips([]);
      setPageError("Please sign in as an admin to load trips.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/admin/trips/list", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setTrips([]);
      setPageError(json?.error || "Could not load trips. Please refresh or contact admin support.");
      setLoading(false);
      return;
    }

    const rows = (json.trips ?? []) as Trip[];
    setTrips(currentStatus === "all" ? rows : rows.filter((trip) => trip.status === currentStatus));
    setLoading(false);
  }, [getAccessToken]);

  useEffect(() => {
    void loadDrivers();
    void loadTrips(status);
  }, [loadDrivers, loadTrips, status]);

  const driverNameById = useMemo(() => {
    const map = new Map<string, string>();
    drivers.forEach((d) => {
      map.set(d.id, `${d.first_name} ${d.last_name}`);
    });
    return map;
  }, [drivers]);

  const tripStats = useMemo(
    () => ({
      total: trips.length,
      active: trips.filter((trip) => ["assigned", "arrived", "ongoing"].includes(trip.status)).length,
      requested: trips.filter((trip) => trip.status === "requested").length,
      revenue: trips.reduce((sum, trip) => sum + Number(trip.fare_amount ?? 0), 0),
    }),
    [trips],
  );

  async function assignDriver(tripId: string, driverId: string) {
    setActionLoadingId(tripId);
    setPageError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setPageError("You are not logged in.");
        return;
      }

      const res = await fetch("/api/admin/trips/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tripId, driverId }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setPageError(json?.error || "Failed to assign driver.");
        return;
      }

      await loadTrips(status);
    } catch (error: unknown) {
      setPageError(errorMessage(error, "Failed to assign driver."));
    } finally {
      setActionLoadingId(null);
    }
  }

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

  function renderActions(trip: Trip) {
    return (
      <div className="moovu-action-row">
        {trip.status === "assigned" && (
          <button
            className="moovu-btn moovu-btn-secondary"
            disabled={actionLoadingId === trip.id}
            onClick={() => void markArrived(trip.id)}
          >
            Arrived
          </button>
        )}

        {trip.status === "arrived" && (
          <Link className="moovu-btn moovu-btn-secondary" href={`/admin/trips/${trip.id}`}>
            Verify OTP
          </Link>
        )}

        {trip.status === "ongoing" && (
          <Link className="moovu-btn moovu-btn-primary" href={`/admin/trips/${trip.id}`}>
            Complete
          </Link>
        )}

        {trip.status !== "completed" && trip.status !== "cancelled" && (
          <button
            className="moovu-btn moovu-btn-danger"
            disabled={actionLoadingId === trip.id}
            onClick={() => void cancelTrip(trip.id)}
          >
            Cancel
          </button>
        )}

        <Link className="moovu-btn moovu-btn-secondary" href={`/admin/trips/${trip.id}`}>
          Open
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <LoadingState
        title="Loading trips"
        description="Preparing trip movement, driver assignment, and dispatch actions."
      />
    );
  }

  return (
    <main className="space-y-6 text-black">
      {pageError && (
        <CenteredMessageBox
          title="Trip action failed"
          message={pageError}
          onClose={() => setPageError(null)}
        />
      )}

      <section className="moovu-hero-panel p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-white/70">
              Trips console
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">
              Track every ride from request to receipt.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/74">
              Filter live states, assign drivers, cancel safely, and open trip details without leaving operations flow.
            </p>
          </div>

          <Link className="moovu-btn bg-white text-slate-950" href="/admin/trips/new">
            New trip
          </Link>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Visible trips" value={String(tripStats.total)} helper={`Filter: ${status}`} />
        <MetricCard label="Requested" value={String(tripStats.requested)} helper="Need dispatch" tone="primary" />
        <MetricCard label="Active" value={String(tripStats.active)} helper="Assigned or moving" tone="success" />
        <MetricCard label="Visible value" value={money(tripStats.revenue)} helper="Fare total in filter" tone="warning" />
      </section>

      <section className="moovu-card p-4 sm:p-5">
        <div className="moovu-filter-row" aria-label="Trip status filters">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={status === s ? "moovu-filter-chip active capitalize" : "moovu-filter-chip capitalize"}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {trips.length === 0 ? (
        <EmptyState
          title="No trips found"
          description="Trips matching this status filter will appear here."
        />
      ) : (
        <>
          <section className="moovu-card hidden overflow-hidden xl:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Rider</th>
                    <th>Driver</th>
                    <th>Payment</th>
                    <th>Fare</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => (
                    <tr key={trip.id}>
                      <td className="max-w-[280px]">
                        <Link href={`/admin/trips/${trip.id}`} className="font-black text-slate-950 hover:text-[var(--moovu-primary)]">
                          {trip.pickup_address}
                        </Link>
                        {parseTripStops(trip.stops).map((stop, index) => (
                          <div key={`${trip.id}-stop-${index}`} className="mt-1 text-xs font-semibold text-blue-700">
                            Stop {index + 1}: {stop.address}
                          </div>
                        ))}
                        <div className="mt-1 text-xs text-slate-500">{trip.dropoff_address}</div>
                      </td>
                      <td>
                        <div className="font-bold text-slate-950">{trip.rider_name ?? "--"}</div>
                        <div className="mt-1 text-xs text-slate-500">{trip.rider_phone ?? "--"}</div>
                      </td>
                      <td>
                        {trip.driver_id ? (
                          <div className="font-bold text-slate-950">
                            {driverNameById.get(trip.driver_id) ?? trip.driver_id}
                          </div>
                        ) : (
                          <select
                            className="min-w-[220px] rounded-2xl border border-[var(--moovu-border)] bg-white p-3 text-sm"
                            defaultValue=""
                            disabled={actionLoadingId === trip.id}
                            onChange={(event) => {
                              const val = event.target.value;
                              if (val) void assignDriver(trip.id, val);
                            }}
                          >
                            <option value="" disabled>
                              Assign driver...
                            </option>
                            {drivers.map((driver) => (
                              <option key={driver.id} value={driver.id}>
                                {driver.first_name} {driver.last_name} ({driver.phone})
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="capitalize">{trip.payment_method}</td>
                      <td className="font-black">{money(trip.fare_amount)}</td>
                      <td>
                        <StatusBadge status={trip.status} />
                      </td>
                      <td>{displayDate(trip.created_at)}</td>
                      <td>{renderActions(trip)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-3 xl:hidden">
            {trips.map((trip) => (
              <article key={trip.id} className="admin-trip-mobile-card moovu-card-interactive">
                <div className="admin-trip-mobile-header">
                  <div className="min-w-0">
                    <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                      Trip {trip.id.slice(0, 8)}
                    </div>
                    <div className="mt-2">
                      <StatusBadge status={trip.status} />
                    </div>
                  </div>
                  <div className="admin-trip-mobile-fare">
                    <span>Fare</span>
                    <strong>{money(trip.fare_amount)}</strong>
                  </div>
                </div>

                <div className="admin-trip-mobile-route">
                  <AdminTripMobileField label="Pickup">
                    {trip.pickup_address || "--"}
                  </AdminTripMobileField>
                  {parseTripStops(trip.stops).map((stop, index) => (
                    <AdminTripMobileField
                      key={`${trip.id}-mobile-stop-${index}`}
                      label={`Stop ${index + 1}`}
                    >
                      {stop.address}
                    </AdminTripMobileField>
                  ))}
                  <AdminTripMobileField label="Dropoff">
                    {trip.dropoff_address || "--"}
                  </AdminTripMobileField>
                </div>

                <div className="admin-trip-mobile-meta">
                  <AdminTripMobileField label="Rider">{trip.rider_name ?? "--"}</AdminTripMobileField>
                  <AdminTripMobileField label="Customer cellphone">
                    {trip.rider_phone ?? "--"}
                  </AdminTripMobileField>
                  <AdminTripMobileField label="Driver">
                    {trip.driver_id ? driverNameById.get(trip.driver_id) ?? trip.driver_id : "Unassigned"}
                  </AdminTripMobileField>
                  <AdminTripMobileField label="Payment" className="capitalize">
                    {trip.payment_method || "--"}
                  </AdminTripMobileField>
                  <AdminTripMobileField label="Created">{displayDate(trip.created_at)}</AdminTripMobileField>
                </div>

                {!trip.driver_id && (
                  <select
                    className="mt-4 min-h-[48px] w-full rounded-2xl border border-[var(--moovu-border)] bg-white p-3 text-sm font-bold text-slate-800"
                    defaultValue=""
                    disabled={actionLoadingId === trip.id}
                    onChange={(event) => {
                      const val = event.target.value;
                      if (val) void assignDriver(trip.id, val);
                    }}
                  >
                    <option value="" disabled>
                      Assign driver...
                    </option>
                    {drivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.first_name} {driver.last_name} ({driver.phone})
                      </option>
                    ))}
                  </select>
                )}

                <div className="admin-trip-mobile-actions mt-4">{renderActions(trip)}</div>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
