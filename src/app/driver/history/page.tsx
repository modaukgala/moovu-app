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
  payment_method: string | null;
  status: string | null;
  created_at: string | null;
  driver_id: string | null;
};

function money(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `R${n.toFixed(2)}`;
}

function displayDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "--";
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

            <div className="flex flex-wrap gap-2">
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

        <section className="grid gap-3 md:grid-cols-3">
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
          <div className="flex flex-wrap gap-2">
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
