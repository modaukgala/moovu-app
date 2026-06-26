"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
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
    <main className="moovu-page moovu-driver-shell text-black">
      <div className="moovu-shell space-y-6">
        <div className="moovu-card p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="moovu-section-title">MOOVU Driver</div>
              <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
                Trip history
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Review your routes, rider details, payment methods, and trip outcomes.
              </p>
            </div>

            <div className="moovu-driver-toolbar-actions">
              <Link href="/driver/trip-offers" className="moovu-btn moovu-btn-secondary">
                Trip offers
              </Link>
              <Link href="/driver" className="moovu-btn moovu-btn-secondary">
                Driver dashboard
              </Link>
              <button onClick={loadTrips} className="moovu-btn moovu-btn-primary">
                Refresh
              </button>
            </div>
          </div>
        </div>

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

        <section className="moovu-driver-metric-grid moovu-driver-metric-grid-3">
          <MetricCard label="Total trips" value={String(trips.length)} helper="All recorded trips" />
          <MetricCard
            label="Completed"
            value={String(completedTrips.length)}
            helper="Finished trips"
            tone="success"
          />
          <MetricCard
            label="Completed fare"
            value={money(completedFare)}
            helper="Gross fare value"
            tone="primary"
          />
        </section>

        <section className="moovu-card p-4 sm:p-5">
          <div className="moovu-driver-filter-row">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                onClick={() => setFilter(item.id)}
                className={`rounded-xl border px-4 py-2 text-sm font-black transition ${
                  filter === item.id
                    ? "border-[var(--moovu-blue)] bg-[var(--moovu-blue)] text-white"
                    : "border-[var(--moovu-border)] bg-white text-slate-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          {filteredTrips.length === 0 ? (
            <EmptyState
              title="No trips found"
              description="There are no driver trips for this filter yet. Completed and active trips will appear here."
            />
          ) : (
            filteredTrips.map((trip) => (
              <article key={trip.id} className="moovu-card p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <StatusBadge status={trip.status} />
                    <div className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                      {displayDate(trip.created_at)}
                    </div>
                  </div>
                  <div className="text-2xl font-black text-slate-950">{money(trip.fare_amount)}</div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                      Pickup
                    </div>
                    <div className="mt-1 font-black text-slate-950">
                      {trip.pickup_address ?? "--"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                      Destination
                    </div>
                    <div className="mt-1 font-black text-slate-950">
                      {trip.dropoff_address ?? "--"}
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-[var(--moovu-border)] bg-[var(--moovu-bg)] p-3">
                    <div className="text-xs font-bold text-slate-500">Ride type</div>
                    <div className="mt-1 font-bold text-slate-950">{rideTypeLabel(trip.ride_option)}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--moovu-border)] bg-[var(--moovu-bg)] p-3">
                    <div className="text-xs font-bold text-slate-500">Rider</div>
                    <div className="mt-1 font-bold text-slate-950">{trip.rider_name ?? "--"}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--moovu-border)] bg-[var(--moovu-bg)] p-3">
                    <div className="text-xs font-bold text-slate-500">Phone</div>
                    <div className="mt-1 font-bold text-slate-950">{trip.rider_phone ?? "--"}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--moovu-border)] bg-[var(--moovu-bg)] p-3">
                    <div className="text-xs font-bold text-slate-500">Payment</div>
                    <div className="mt-1 font-bold text-slate-950">{trip.payment_method ?? "--"}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--moovu-border)] bg-[var(--moovu-bg)] p-3">
                    <div className="text-xs font-bold text-slate-500">Commission</div>
                    <div className="mt-1 font-bold text-slate-950">{money(trip.commission_amount)}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--moovu-border)] bg-[var(--moovu-bg)] p-3">
                    <div className="text-xs font-bold text-slate-500">Driver earnings</div>
                    <div className="mt-1 font-bold text-slate-950">{money(trip.driver_net_earnings ?? trip.fare_amount)}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--moovu-border)] bg-[var(--moovu-bg)] p-3">
                    <div className="text-xs font-bold text-slate-500">Completed</div>
                    <div className="mt-1 font-bold text-slate-950">{displayDate(trip.completed_at ?? trip.created_at)}</div>
                  </div>
                </div>

                {trip.status === "completed" && (
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      className="moovu-btn moovu-btn-secondary"
                      onClick={() => {
                        setRatingTripId(trip.id);
                        setRating(5);
                        setRatingComment("");
                      }}
                    >
                      Rate customer
                    </button>
                    <button
                      type="button"
                      className="moovu-btn moovu-btn-secondary"
                      onClick={() => setMsg("Trip summary is shown on this card.")}
                    >
                      Trip summary
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </section>
      </div>
      <DriverBottomNav />
    </main>
  );
}
