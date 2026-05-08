"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CustomerAppHeader from "@/components/app-shell/CustomerAppHeader";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";

type RiderTrip = {
  id: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  status: string | null;
  created_at: string | null;
  driver_id: string | null;
  cancel_reason?: string | null;
  cancellation_reason?: string | null;
  cancellation_type?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  cancellation_fee_amount?: number | null;
  cancellation_driver_amount?: number | null;
  cancellation_moovu_amount?: number | null;
  cancellation_policy_code?: string | null;
};

type TripsResponse = {
  ok?: boolean;
  trips?: RiderTrip[];
  error?: string;
};

const filters = ["all", "completed", "cancelled", "ongoing", "assigned", "requested"] as const;

function money(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `R${n.toFixed(2)}`;
}

function dash(value: string | null | undefined) {
  return value?.trim() || "--";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  return new Date(value).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function filterLabel(value: string) {
  return value === "all" ? "All" : value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function cancellationLabel(trip: RiderTrip) {
  const reason = trip.cancellation_reason || trip.cancel_reason || "Cancelled";
  const fee = Number(trip.cancellation_fee_amount ?? 0);
  if (trip.cancellation_type === "no_show") {
    return `No-show fee: ${money(fee)}. Reason: ${reason}.`;
  }
  if (fee > 0) {
    return `Late cancellation fee: ${money(fee)}. Reason: ${reason}.`;
  }
  return `Cancelled for free. Reason: ${reason}.`;
}

export default function RiderHistoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [trips, setTrips] = useState<RiderTrip[]>([]);
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");

  const loadTrips = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      router.replace("/customer/auth?next=/ride/history");
      return;
    }

    const res = await fetch("/api/customer/trips", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const json = (await res.json().catch(() => null)) as TripsResponse | null;

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load trip history.");
      setLoading(false);
      return;
    }

    setTrips(json.trips ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTrips();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadTrips]);

  const filteredTrips = useMemo(() => {
    if (filter === "all") return trips;
    return trips.filter((trip) => trip.status === filter);
  }, [trips, filter]);

  const completedCount = useMemo(
    () => trips.filter((trip) => trip.status === "completed").length,
    [trips]
  );

  if (loading) {
    return <LoadingState title="Loading your trips" description="Building your MOOVU ride history." />;
  }

  return (
    <main className="moovu-app-screen">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-app-container">
        <CustomerAppHeader
          title="My trips"
          subtitle="Track past rides, open active trips, and view receipts."
          actionHref="/book"
          actionLabel="Book"
        />

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="moovu-app-metric moovu-app-metric-primary">
            <div className="moovu-app-metric-label">Total trips</div>
            <div className="moovu-app-metric-value">{trips.length}</div>
          </div>
          <div className="moovu-app-metric moovu-app-metric-success">
            <div className="moovu-app-metric-label">Completed</div>
            <div className="moovu-app-metric-value">{completedCount}</div>
          </div>
          <div className="moovu-app-metric">
            <div className="moovu-app-metric-label">Current filter</div>
            <div className="moovu-app-metric-value">{filterLabel(filter)}</div>
          </div>
        </section>

        <section className="moovu-app-card mt-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="moovu-kicker">Ride history</div>
              <h2 className="mt-1 text-xl font-black text-slate-950">Trips under your account</h2>
            </div>

            <div className="moovu-filter-row" aria-label="Trip status filters">
              {filters.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={filter === value ? "moovu-filter-chip active" : "moovu-filter-chip"}
                  onClick={() => setFilter(value)}
                >
                  {filterLabel(value)}
                </button>
              ))}
            </div>
          </div>

          {filteredTrips.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No trips found"
                description="Trips will appear here after you request a MOOVU ride."
                action={
                  <Link href="/book" className="moovu-btn moovu-btn-primary">
                    Book a ride
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="mt-5 grid gap-3">
              {filteredTrips.map((trip) => (
                <article key={trip.id} className="moovu-trip-card">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={trip.status} />
                        <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                          {formatDate(trip.created_at)}
                        </span>
                      </div>

                      <div className="moovu-route-mini mt-4">
                        <div className="moovu-route-mini-row">
                          <span className="moovu-route-mini-dot" />
                          <div className="min-w-0">
                            <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                              Pickup
                            </div>
                            <div className="mt-1 truncate text-sm font-black text-slate-950">
                              {dash(trip.pickup_address)}
                            </div>
                          </div>
                        </div>
                        <div className="moovu-route-mini-row">
                          <span className="moovu-route-mini-dot dropoff" />
                          <div className="min-w-0">
                            <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                              Destination
                            </div>
                            <div className="mt-1 truncate text-sm font-black text-slate-950">
                              {dash(trip.dropoff_address)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:min-w-48 sm:text-right">
                      <div className="text-2xl font-black text-slate-950">{money(trip.fare_amount)}</div>
                      <div className="text-sm font-bold text-slate-600">{dash(trip.payment_method)}</div>
                    </div>
                  </div>

                  {trip.status === "cancelled" || trip.cancel_reason || trip.cancellation_reason ? (
                    <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-3 text-sm font-semibold text-red-700">
                      {cancellationLabel(trip)}
                      {trip.cancelled_at ? (
                        <span className="mt-1 block text-xs text-red-600">
                          Recorded {formatDate(trip.cancelled_at)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href={`/ride/${trip.id}`} className="moovu-btn moovu-btn-primary">
                      Open trip
                    </Link>
                    <Link href={`/ride/${trip.id}/receipt`} className="moovu-btn moovu-btn-secondary">
                      Receipt
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <CustomerBottomNav />
    </main>
  );
}
