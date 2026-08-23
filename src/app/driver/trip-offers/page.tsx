"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleX,
  Clock3,
  MapPin,
  RefreshCw,
  Route,
  TimerOff,
  UserRoundCheck,
} from "lucide-react";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import DriverSectionTabs from "@/components/app-shell/DriverSectionTabs";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import { supabaseClient } from "@/lib/supabase/client";

type OfferOutcome =
  | "accepted_by_you"
  | "accepted_by_another"
  | "missed"
  | "declined"
  | "cancelled"
  | "pending";

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
  outcome: OfferOutcome;
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

type OfferPagination = {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

const OFFER_PAGE_SIZE = 20;

const FILTERS: Array<{ id: "all" | OfferOutcome; label: string }> = [
  { id: "all", label: "All" },
  { id: "accepted_by_you", label: "Accepted by you" },
  { id: "accepted_by_another", label: "Accepted elsewhere" },
  { id: "missed", label: "Missed" },
  { id: "declined", label: "Declined" },
  { id: "cancelled", label: "Cancelled" },
];

const OUTCOME_META: Record<OfferOutcome, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  accepted_by_you: { label: "Accepted by you", className: "is-success", icon: CheckCircle2 },
  accepted_by_another: { label: "Accepted by another driver", className: "is-warning", icon: UserRoundCheck },
  missed: { label: "You did not respond", className: "is-danger", icon: TimerOff },
  declined: { label: "You declined", className: "is-danger", icon: CircleX },
  cancelled: { label: "Trip cancelled", className: "is-neutral", icon: CircleX },
  pending: { label: "Awaiting response", className: "is-primary", icon: Clock3 },
};

function money(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return `R${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function distance(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) && amount > 0 ? `${amount.toFixed(1)} km` : "--";
}

function duration(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) && amount > 0 ? `${Math.round(amount)} min` : "--";
}

function displayDate(value: string | null | undefined) {
  if (!value) return "--";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [summary, setSummary] = useState<OfferSummary>({ received: 0, accepted: 0, declined: 0, missed: 0, cancelled: 0 });
  const [filter, setFilter] = useState<"all" | OfferOutcome>("all");
  const [pagination, setPagination] = useState<OfferPagination>({ page: 1, limit: OFFER_PAGE_SIZE, total: 0, hasMore: false });
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadOffers(page = 1) {
    const append = page > 1;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setMessage(null);

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      window.location.href = "/driver/login?next=/driver/trip-offers";
      return;
    }

    const response = await fetch(`/api/driver/offers/history?page=${page}&limit=${OFFER_PAGE_SIZE}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const json = await response.json().catch(() => null);

    if (!response.ok || !json?.ok) {
      setMessage(json?.error || "Could not load your received trip offers.");
      if (append) setLoadingMore(false);
      else setLoading(false);
      return;
    }

    setOffers((current) => append ? [...current, ...(json.offers ?? [])] : (json.offers ?? []));
    setSummary(json.summary ?? { received: 0, accepted: 0, declined: 0, missed: 0, cancelled: 0 });
    setPagination(json.pagination ?? { page, limit: OFFER_PAGE_SIZE, total: json.summary?.received ?? 0, hasMore: false });

    if (json.setupRequired) {
      setMessage("Trip offer history needs the dispatch offer migration before it can show older offer rows.");
    }

    if (append) setLoadingMore(false);
    else setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOffers(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filteredOffers = useMemo(() => {
    if (filter === "all") return offers;
    return offers.filter((offer) => offer.outcome === filter);
  }, [filter, offers]);

  const acceptanceRate = summary.received > 0 ? Math.round((summary.accepted / summary.received) * 100) : 0;

  if (loading) {
    return <LoadingState title="Loading trip offers" description="Preparing the ride requests MOOVU has sent to your driver profile." />;
  }

  return (
    <main className="driver-mobile-page driver-offer-history-page text-black">
      {message && <CenteredMessageBox message={message} onClose={() => setMessage(null)} />}

      <div className="driver-mobile-container">
        <header className="driver-page-heading">
          <Link href="/driver/history" className="driver-icon-button" aria-label="Back to trip history">
            <ArrowLeft aria-hidden="true" />
          </Link>
          <div>
            <span>MOOVU Driver</span>
            <h1>Trip offers</h1>
            <p>A clear record of every request sent to you and what happened next.</p>
          </div>
          <button
            type="button"
            className="driver-icon-button driver-history-calendar"
            aria-label="Refresh trip offers"
            disabled={loadingMore}
            onClick={() => void loadOffers()}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </header>

        <DriverSectionTabs section="trips" />

        <section className="driver-offer-summary" aria-label="Offer summary">
          <div><span>Received</span><strong>{summary.received.toLocaleString()}</strong></div>
          <div><span>Accepted</span><strong>{summary.accepted.toLocaleString()}</strong></div>
          <div><span>Acceptance</span><strong>{acceptanceRate}%</strong></div>
        </section>

        <div className="driver-offer-filter-strip" role="group" aria-label="Filter trip offers">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? "is-active" : undefined}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <section className="driver-offer-list" aria-label="Trip offer history">
          <div className="driver-section-heading">
            <h2>Offer history</h2>
            <span>{filteredOffers.length} loaded</span>
          </div>

          {filteredOffers.length === 0 ? (
            <EmptyState title="No trip offers found" description="No loaded offers match this filter. Load more history or choose another outcome." />
          ) : (
            filteredOffers.map((offer) => {
              const meta = OUTCOME_META[offer.outcome];
              const OutcomeIcon = meta.icon;

              return (
                <article key={offer.id} className="driver-offer-list-row">
                  <div className="driver-offer-row-heading">
                    <time>{displayDate(offer.offered_at)}</time>
                    <strong>{money(offer.trip?.fare_amount)}</strong>
                  </div>

                  <div className="driver-offer-route">
                    <div>
                      <MapPin aria-hidden="true" />
                      <span><small>Pickup</small><strong>{offer.trip?.pickup_address ?? "Pickup not available"}</strong></span>
                    </div>
                    <div>
                      <Route aria-hidden="true" />
                      <span><small>Destination</small><strong>{offer.trip?.dropoff_address ?? "Destination not available"}</strong></span>
                    </div>
                  </div>

                  <div className="driver-offer-row-footer">
                    <span className={`driver-offer-outcome ${meta.className}`}>
                      <OutcomeIcon aria-hidden="true" />
                      {meta.label}
                    </span>
                    <span>{rideTypeLabel(offer.trip?.ride_option)}</span>
                    <span>{distance(offer.trip?.distance_km)}</span>
                    <span>{duration(offer.trip?.duration_min)}</span>
                    <span>{offer.trip?.payment_method ?? "Cash"}</span>
                    <ChevronRight aria-hidden="true" />
                  </div>
                </article>
              );
            })
          )}

          {pagination.hasMore && (
            <button
              type="button"
              className="driver-offer-load-more"
              disabled={loadingMore}
              onClick={() => void loadOffers(pagination.page + 1)}
            >
              {loadingMore ? "Loading more offers..." : `Load more (${offers.length.toLocaleString()} of ${pagination.total.toLocaleString()})`}
            </button>
          )}
        </section>
      </div>

      <DriverBottomNav />
    </main>
  );
}
