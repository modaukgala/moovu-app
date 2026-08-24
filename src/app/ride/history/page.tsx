"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Flag, MapPin, ReceiptText } from "lucide-react";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import CustomerBackHomeNav from "@/components/app-shell/CustomerBackHomeNav";
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
  final_fare?: number | null;
  final_add_stop_increase?: number | null;
  stop_waiting_fee?: number | null;
  distance_km?: number | null;
  duration_min?: number | null;
  payment_method: string | null;
  status: string | null;
  created_at: string | null;
  driver_id: string | null;
  ride_type?: string | null;
  stops?: unknown;
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

type TripFilter = "all" | "completed" | "cancelled" | "ongoing" | "assigned" | "requested";
const primaryFilters: TripFilter[] = ["all", "completed", "cancelled"];

function money(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `R${n.toFixed(2)}`;
}

function dash(value: string | null | undefined) {
  return value?.trim() || "--";
}

function rideTypeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "group" || normalized === "xl" || normalized.includes("xl")) return "MOOVU Go XL";
  if (normalized === "scheduled") return "Scheduled ride";
  return "MOOVU Go";
}

function stopsCount(value: unknown) {
  return Array.isArray(value) ? Math.min(value.length, 2) : 0;
}

function displayDistance(value: number | null | undefined) {
  return value == null ? "--" : `${Number(value).toFixed(1)} km`;
}

function displayDuration(value: number | null | undefined) {
  return value == null ? "--" : `${Math.round(Number(value))} min`;
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
  const [filter, setFilter] = useState<TripFilter>("all");
  const [roleMismatch, setRoleMismatch] = useState(false);

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

    const role = String(session.user.user_metadata?.role || session.user.app_metadata?.role || "").toLowerCase();
    if (role === "driver") {
      setRoleMismatch(true);
      setLoading(false);
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

  const tripSummary = useMemo(() => {
    const completed = trips.filter((trip) => trip.status === "completed");
    return {
      all: trips.length,
      completed: completed.length,
      cancelled: trips.filter((trip) => trip.status === "cancelled").length,
      completedFare: completed.reduce(
        (total, trip) => total + Number(trip.final_fare ?? trip.fare_amount ?? 0),
        0,
      ),
    };
  }, [trips]);

  if (loading) {
    return <LoadingState title="Loading your trips" description="Building your MOOVU ride history." />;
  }

  async function signInAsCustomer() {
    await supabaseClient.auth.signOut();
    window.location.href = "/customer/auth?next=/ride/history";
  }

  if (roleMismatch) {
    return (
      <main className="moovu-app-screen">
        <div className="moovu-app-container"><CustomerBackHomeNav fallbackHref="/" /><section className="customer-role-page"><span>Driver account detected</span><h1>This trip history is for MOOVU customers</h1><p>Your Driver account remains unchanged. Open Driver trips or explicitly sign in with a Customer account.</p><div><Link href="https://driver.moovurides.co.za/driver/history" className="moovu-btn moovu-btn-primary">Open Driver trips</Link><button type="button" className="moovu-btn moovu-btn-secondary" onClick={signInAsCustomer}>Sign in as Customer</button></div></section></div>
        <CustomerBottomNav />
      </main>
    );
  }

  return (
    <main className="moovu-app-screen">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-app-container">
        <CustomerBackHomeNav fallbackHref="/book" />
        <header className="customer-history-header customer-history-v4-header">
          <div>
            <div className="moovu-kicker">MOOVU Customer</div>
            <h1>Trip history</h1>
            <p>Every ride, fare and receipt in one place.</p>
          </div>
        </header>

        <section className="customer-history-v4">
          <div className="customer-history-summary-tabs" role="tablist" aria-label="Trip summary">
            {primaryFilters.map((value) => {
              const count = value === "all"
                ? tripSummary.all
                : value === "completed"
                  ? tripSummary.completed
                  : tripSummary.cancelled;
              const detail = value === "completed" && tripSummary.completedFare > 0
                ? money(tripSummary.completedFare)
                : `${count} ${count === 1 ? "trip" : "trips"}`;

              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  className={filter === value ? "is-active" : ""}
                  onClick={() => setFilter(value)}
                >
                  <span>{filterLabel(value)}</span>
                  <strong>{detail}</strong>
                </button>
              );
            })}
          </div>

          <div className="customer-history-toolbar">
            <div>
              <span>{filterLabel(filter)}</span>
              <strong>{filteredTrips.length} {filteredTrips.length === 1 ? "ride" : "rides"}</strong>
            </div>
            <label className="customer-history-more-filter">
              <span className="sr-only">Filter by another trip status</span>
              <select
                value={primaryFilters.includes(filter) ? "more" : filter}
                onChange={(event) => {
                  if (event.target.value !== "more") setFilter(event.target.value as TripFilter);
                }}
              >
                <option value="more">Other statuses</option>
                <option value="ongoing">Ongoing</option>
                <option value="assigned">Assigned</option>
                <option value="requested">Requested</option>
              </select>
            </label>
          </div>

          {filteredTrips.length === 0 ? (
            <div className="customer-history-empty">
              <EmptyState
                title="No MOOVU trips yet"
                description="Your completed, cancelled and active rides will appear here after your first booking."
                action={
                  <Link href="/book" className="moovu-btn moovu-btn-primary">
                    Book a ride
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="customer-trip-list">
              {filteredTrips.map((trip) => (
                <article key={trip.id} className="customer-trip-list-row">
                  <div className="customer-trip-row-topline">
                    <time dateTime={trip.created_at ?? undefined}>{formatDate(trip.created_at)}</time>
                    <StatusBadge status={trip.status} />
                    <strong>{money(trip.final_fare ?? trip.fare_amount)}</strong>
                  </div>

                  <div className="customer-trip-compact-route">
                    <div>
                      <MapPin aria-hidden="true" />
                      <span><small>Pickup</small><strong>{dash(trip.pickup_address)}</strong></span>
                    </div>
                    <div>
                      <Flag aria-hidden="true" />
                      <span><small>Destination</small><strong>{dash(trip.dropoff_address)}</strong></span>
                    </div>
                  </div>

                  <div className="customer-trip-row-footer">
                    <div>
                      <span>{rideTypeLabel(trip.ride_type)}</span>
                      <span>{displayDistance(trip.distance_km)}</span>
                      <span>{displayDuration(trip.duration_min)}</span>
                      <span>{dash(trip.payment_method)}</span>
                      {stopsCount(trip.stops) > 0 ? <span>{stopsCount(trip.stops)} stop(s)</span> : null}
                    </div>
                    <div className="customer-trip-row-actions">
                      <Link href={`/ride/${trip.id}/receipt`} aria-label={`Open receipt for ${formatDate(trip.created_at)}`}>
                        <ReceiptText aria-hidden="true" />
                      </Link>
                      <Link href={`/ride/${trip.id}`} aria-label={`Open trip from ${formatDate(trip.created_at)}`}>
                        <ChevronRight aria-hidden="true" />
                      </Link>
                    </div>
                  </div>

                  {trip.status === "cancelled" || trip.cancel_reason || trip.cancellation_reason ? (
                    <div className="customer-trip-cancellation">
                      {cancellationLabel(trip)}
                      {trip.cancelled_at ? (
                        <span>
                          Recorded {formatDate(trip.cancelled_at)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
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
