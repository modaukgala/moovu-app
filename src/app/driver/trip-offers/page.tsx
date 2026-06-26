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

type OfferTrip = {
  id: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | string | null;
  distance_km: number | string | null;
  duration_min: number | string | null;
  payment_method: string | null;
  status: string | null;
  offer_status: string | null;
  ride_option: string | null;
  created_at: string | null;
};

type DriverOffer = {
  id: string;
  trip_id: string | null;
  status: string | null;
  offered_at: string | null;
  visible_until: string | null;
  escalates_at: string | null;
  accept_deadline_at: string | null;
  responded_at: string | null;
  distance_to_pickup_km: number | string | null;
  dispatch_score: number | string | null;
  trip: OfferTrip | null;
};

type OfferSummary = {
  received: number;
  accepted: number;
  declined: number;
  missed: number;
  cancelled: number;
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "accepted", label: "Accepted" },
  { id: "declined", label: "Declined" },
  { id: "expired", label: "Missed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "pending", label: "Pending" },
] as const;

function money(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return `R${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

function distance(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "--";
  return `${n.toFixed(1)} km`;
}

function duration(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "--";
  return `${Math.round(n)} min`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function rideTypeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "group" || normalized === "xl" || normalized.includes("xl")) return "MOOVU Go XL";
  if (normalized === "scheduled") return "Scheduled ride";
  return "MOOVU Go";
}

export default function DriverTripOffersPage() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [offers, setOffers] = useState<DriverOffer[]>([]);
  const [summary, setSummary] = useState<OfferSummary>({
    received: 0,
    accepted: 0,
    declined: 0,
    missed: 0,
    cancelled: 0,
  });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");

  async function loadOffers() {
    setLoading(true);
    setMessage(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      window.location.href = "/driver/login?next=/driver/trip-offers";
      return;
    }

    const res = await fetch("/api/driver/offers/history", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMessage(json?.error || "Could not load your received trip offers.");
      setLoading(false);
      return;
    }

    setOffers(json.offers ?? []);
    setSummary(
      json.summary ?? {
        received: 0,
        accepted: 0,
        declined: 0,
        missed: 0,
        cancelled: 0,
      },
    );
    if (json.setupRequired) {
      setMessage("Trip offer history needs the dispatch offer migration before it can show older offer rows.");
    }
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOffers();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const filteredOffers = useMemo(() => {
    if (filter === "all") return offers;
    return offers.filter((offer) => offer.status === filter);
  }, [filter, offers]);

  const acceptanceRate = summary.received > 0
    ? Math.round((summary.accepted / summary.received) * 100)
    : 0;

  if (loading) {
    return (
      <LoadingState
        title="Loading trip offers"
        description="Preparing the ride requests MOOVU has sent to your driver profile."
      />
    );
  }

  return (
    <main className="moovu-page moovu-driver-shell min-h-screen pb-32 text-slate-950">
      {message && <CenteredMessageBox message={message} onClose={() => setMessage(null)} />}

      <div className="moovu-shell space-y-6 py-6">
        <section className="moovu-card p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="moovu-section-title">Driver profile</div>
              <h1 className="mt-2 text-3xl font-black">Trip offers received</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                See every ride request sent to you, including accepted, declined, missed, cancelled, and pending offers.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/driver" className="moovu-btn moovu-btn-secondary">
                Driver home
              </Link>
              <button type="button" className="moovu-btn moovu-btn-primary" onClick={loadOffers}>
                Refresh
              </button>
            </div>
          </div>
        </section>

        <section className="moovu-driver-metric-grid moovu-driver-metric-grid-3">
          <MetricCard label="Offers received" value={String(summary.received)} helper="All received requests" />
          <MetricCard label="Accepted" value={String(summary.accepted)} helper={`${acceptanceRate}% acceptance`} tone="success" />
          <MetricCard label="Missed or declined" value={String(summary.missed + summary.declined)} helper="Expired or rejected offers" tone="warning" />
        </section>

        <section className="moovu-card p-4 sm:p-5">
          <div className="moovu-driver-filter-row">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
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
          {filteredOffers.length === 0 ? (
            <EmptyState
              title="No trip offers found"
              description="Received trip offers will appear here once MOOVU dispatch sends requests to your driver profile."
            />
          ) : (
            filteredOffers.map((offer) => (
              <article key={offer.id} className="moovu-card p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <StatusBadge status={offer.status === "expired" ? "missed" : offer.status} />
                    <div className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                      Offered {displayDate(offer.offered_at)}
                    </div>
                  </div>
                  <div className="text-2xl font-black text-slate-950">
                    {money(offer.trip?.fare_amount)}
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                      Pickup
                    </div>
                    <div className="mt-1 font-black text-slate-950">
                      {offer.trip?.pickup_address ?? "Pickup not available"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                      Destination
                    </div>
                    <div className="mt-1 font-black text-slate-950">
                      {offer.trip?.dropoff_address ?? "Destination not available"}
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-4">
                  <Info label="Ride" value={rideTypeLabel(offer.trip?.ride_option)} />
                  <Info label="To pickup" value={distance(offer.distance_to_pickup_km)} />
                  <Info label="Trip distance" value={distance(offer.trip?.distance_km)} />
                  <Info label="Trip time" value={duration(offer.trip?.duration_min)} />
                </div>

                <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-[var(--moovu-border)] bg-[var(--moovu-bg)] p-3 text-sm font-semibold text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    Response: {offer.responded_at ? displayDate(offer.responded_at) : "No response recorded"}
                  </span>
                  <span>
                    Deadline: {displayDate(offer.accept_deadline_at)}
                  </span>
                </div>
              </article>
            ))
          )}
        </section>
      </div>

      <DriverBottomNav />
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--moovu-border)] bg-[var(--moovu-bg)] p-3">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 font-bold text-slate-950">{value}</div>
    </div>
  );
}
