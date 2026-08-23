"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CarFront,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  SlidersHorizontal,
  WalletCards,
  XCircle,
} from "lucide-react";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import DriverSectionTabs from "@/components/app-shell/DriverSectionTabs";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";

type DriverTrip = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  commission_amount?: number | null;
  driver_net_earnings?: number | null;
  payment_method: string | null;
  status: string | null;
  created_at: string | null;
  completed_at?: string | null;
  driver_id: string | null;
  ride_option?: string | null;
};

function money(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `R${n.toFixed(2)}`;
}

function displayDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "--";
}

function rideTypeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "group" || normalized === "xl" || normalized.includes("xl")) return "MOOVU Go XL";
  if (normalized === "scheduled") return "Scheduled ride";
  return "MOOVU Go";
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "ongoing", label: "Ongoing" },
] as const;

export default function DriverHistoryPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [filter, setFilter] = useState("all");
  const [ratingTripId, setRatingTripId] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingBusy, setRatingBusy] = useState(false);

  async function loadTrips() {
    setLoading(true);
    setMsg(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      window.location.href = "/driver/login";
      return;
    }

    const res = await fetch("/api/driver/history", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: "no-store",
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      setMsg("Driver history route is not returning JSON.");
      setLoading(false);
      return;
    }

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load trip history.");
      setLoading(false);
      return;
    }

    setTrips(json.trips ?? []);
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTrips();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const filteredTrips = useMemo(() => {
    if (filter === "all") return trips;
    return trips.filter((trip) => trip.status === filter);
  }, [trips, filter]);

  const completedTrips = useMemo(
    () => trips.filter((trip) => trip.status === "completed"),
    [trips],
  );
  const completedFare = completedTrips.reduce(
    (total, trip) => total + Number(trip.fare_amount ?? 0),
    0,
  );

  async function submitCustomerRating() {
    if (!ratingTripId) return;
    setRatingBusy(true);
    setMsg(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      window.location.href = "/driver/login";
      return;
    }

    const res = await fetch("/api/driver/rate-customer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        tripId: ratingTripId,
        rating,
        comment: ratingComment,
      }),
    });

    const json = await res.json().catch(() => null);
    setRatingBusy(false);

    if (!res.ok || !json?.ok) {
      setMsg(json?.error || "Could not save this rating. Please try again.");
      return;
    }

    setMsg("Customer rating saved.");
    setRatingTripId(null);
    setRating(5);
    setRatingComment("");
  }

  if (loading) {
    return (
      <LoadingState
        title="Loading trip history"
        description="Preparing your completed, active, and cancelled MOOVU trips."
      />
    );
  }

  return (
    <main className="driver-mobile-page driver-history-v3 text-black">
      <div className="driver-mobile-container">
        <header className="driver-page-heading">
          <Link href="/driver" className="driver-icon-button" aria-label="Back to driver home">
            <ArrowLeft aria-hidden="true" />
          </Link>
          <div>
            <span>MOOVU Driver</span>
            <h1>Trip history</h1>
            <p>Review your routes, rider details, payment methods, and trip outcomes.</p>
          </div>
          <button
            type="button"
            className="driver-icon-button driver-history-calendar"
            aria-label="Open trip filters"
            onClick={() => document.getElementById("driver-history-filters")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          >
            <CalendarDays aria-hidden="true" />
          </button>
        </header>

        <DriverSectionTabs section="trips" />

        <button type="button" onClick={loadTrips} className="driver-refresh-button">
          <RefreshCw aria-hidden="true" />
          Refresh
        </button>

        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

        {ratingTripId && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/45 px-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setRatingTripId(null)}
          >
            <div
              className="w-full max-w-md rounded-[30px] border border-[var(--moovu-border)] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="moovu-section-title">Rate customer</div>
                  <h2 className="mt-2 text-2xl font-black text-slate-950">Trip feedback</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                    Rate this completed trip experience. This helps MOOVU monitor rider reliability.
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700"
                  onClick={() => setRatingTripId(null)}
                >
                  X
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                    Rating
                  </span>
                  <select
                    className="moovu-input bg-white"
                    value={rating}
                    onChange={(event) => setRating(Number(event.target.value))}
                  >
                    <option value={5}>5 - Excellent</option>
                    <option value={4}>4 - Good</option>
                    <option value={3}>3 - Average</option>
                    <option value={2}>2 - Poor</option>
                    <option value={1}>1 - Very poor</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                    Comment
                  </span>
                  <textarea
                    className="moovu-input min-h-[110px] resize-none"
                    placeholder="Optional note"
                    value={ratingComment}
                    onChange={(event) => setRatingComment(event.target.value)}
                  />
                </label>
                <button
                  className="moovu-btn moovu-btn-primary w-full justify-center"
                  disabled={ratingBusy}
                  onClick={() => void submitCustomerRating()}
                >
                  {ratingBusy ? "Saving..." : "Submit rating"}
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="driver-history-stats" aria-label="Trip totals">
          <article>
            <div><span>Total trips</span><CalendarDays aria-hidden="true" /></div>
            <strong>{trips.length}</strong>
            <small>All recorded trips</small>
          </article>
          <article className="is-success">
            <div><span>Completed</span><CheckCircle2 aria-hidden="true" /></div>
            <strong>{completedTrips.length}</strong>
            <small>Finished trips</small>
          </article>
          <article>
            <div><span>Completed fare</span><WalletCards aria-hidden="true" /></div>
            <strong>{money(completedFare)}</strong>
            <small>Gross fare value</small>
          </article>
        </section>

        <section id="driver-history-filters" className="driver-history-filters">
          <div>
            <CalendarDays aria-hidden="true" />
            <span><small>Date range</small><strong>All time</strong></span>
          </div>
          <label>
            <SlidersHorizontal aria-hidden="true" />
            <span>
              <small>Trip status</small>
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                {FILTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </span>
          </label>
        </section>

        <section className="driver-trip-list">
          <div className="driver-section-heading">
            <h2>Recent trips</h2>
            <span>{filteredTrips.length} shown</span>
          </div>
          {filteredTrips.length === 0 ? (
            <EmptyState
              title="No trips found"
              description="There are no driver trips for this filter yet. Completed and active trips will appear here."
            />
          ) : (
            filteredTrips.map((trip) => (
              <article key={trip.id} className={`driver-trip-row is-${trip.status ?? "unknown"}`}>
                <div className="driver-trip-row-heading">
                  <time>{displayDate(trip.created_at)}</time>
                  <strong>{money(trip.fare_amount)}</strong>
                </div>

                <div className="driver-trip-route">
                  <span><i className="pickup" /><span><b>Pickup</b><strong>{trip.pickup_address ?? "--"}</strong></span></span>
                  <span><i className="dropoff" /><span><b>Destination</b><strong>{trip.dropoff_address ?? "--"}</strong></span></span>
                </div>

                <div className="driver-trip-row-meta">
                  <span className="driver-trip-status-icon">
                    {trip.status === "completed"
                      ? <CheckCircle2 aria-hidden="true" />
                      : trip.status === "cancelled"
                        ? <XCircle aria-hidden="true" />
                        : <CarFront aria-hidden="true" />}
                  </span>
                  <StatusBadge status={trip.status} />
                  <span>{trip.payment_method ?? "Cash"}</span>
                  <span>{rideTypeLabel(trip.ride_option)}</span>
                </div>

                <details className="driver-trip-details">
                  <summary><span>Trip and customer details</span><ChevronRight aria-hidden="true" /></summary>
                  <div className="driver-trip-details-grid">
                    <div>
                      <small>Customer</small>
                      <strong>{trip.rider_name ?? "Customer details unavailable"}</strong>
                    </div>
                    <div>
                      <small>Commission</small>
                      <strong>{money(trip.commission_amount)}</strong>
                    </div>
                    <div>
                      <small>Driver earnings</small>
                      <strong>{money(trip.driver_net_earnings ?? trip.fare_amount)}</strong>
                    </div>
                    {trip.status === "completed" && (
                      <button
                        type="button"
                        onClick={() => {
                          setRatingTripId(trip.id);
                          setRating(5);
                          setRatingComment("");
                        }}
                      >
                        Rate customer
                      </button>
                    )}
                  </div>
                </details>
              </article>
            ))
          )}
        </section>
      </div>
      <DriverBottomNav />
    </main>
  );
}
