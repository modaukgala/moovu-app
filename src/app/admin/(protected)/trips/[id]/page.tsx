"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type Trip = {
  id: string;
  driver_id: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string;
  dropoff_address: string;
  payment_method: string;
  fare_amount: number | null;
  status: string;
  cancel_reason: string | null;
  created_at: string;
  offer_status: string | null;
  offer_expires_at: string | null;
  stops?: unknown;
  original_fare?: number | null;
  final_add_stop_increase?: number | null;
  final_fare?: number | null;
  stop_waiting_fee?: number | null;
};

type TripStop = {
  address: string;
};

type TripEvent = {
  id: string;
  event_type: string;
  message: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
};

type Driver = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  online: boolean | null;
  busy: boolean | null;
  status: string;
};

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

export default function TripDetailPage() {
  const params = useParams<{ id: string }>();
  const tripId = params.id;
  const router = useRouter();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [events, setEvents] = useState<TripEvent[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pageError, setPageError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setPageError(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session?.access_token) {
      setTrip(null);
      setEvents([]);
      setDrivers([]);
      setPageError("Please sign in as an admin to view trip details.");
      setLoading(false);
      return;
    }

    const res = await fetch(`/api/admin/trips/${encodeURIComponent(tripId)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setTrip(null);
      setEvents([]);
      setDrivers([]);
      setPageError(json?.error || "Could not load trip details. Please refresh or contact admin support.");
      setLoading(false);
      return;
    }

    setTrip((json.trip as Trip | null) ?? null);
    setEvents((json.events as TripEvent[] | null) ?? []);
    setDrivers((json.drivers as Driver[] | null) ?? []);
    setLoading(false);
  }, [tripId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadAll();
    }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadAll]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const driverId = trip?.driver_id ?? null;
  const assignedDriver = driverId ? drivers.find((x) => x.id === driverId) : null;
  const driverLabel = assignedDriver
    ? `${assignedDriver.first_name} ${assignedDriver.last_name} (${assignedDriver.phone})`
    : driverId ?? "Unassigned";
  const tripStops = parseTripStops(trip?.stops);
  const offerSecondsLeft = trip?.offer_expires_at
    ? Math.ceil((new Date(trip.offer_expires_at).getTime() - nowMs) / 1000)
    : null;

  async function offerNearest(exclude: string[] = []) {
    if (!trip) return;

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    const res = await fetch("/api/admin/trips/auto-assign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
      },
      body: JSON.stringify({ tripId: trip.id, excludeDriverIds: exclude }),
    });

    const json = await res.json();
    if (!json.ok) {
      setPageError(json.error || "Offer failed");
      return;
    }

    await loadAll();
  }

  async function cancelTrip() {
    if (!trip) return;
    const reason = prompt("Cancel reason?")?.trim();
    if (!reason) return;

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session?.access_token) {
      setPageError("Please sign in as an admin to cancel trips.");
      return;
    }

    const res = await fetch("/api/admin/trips/cancel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ tripId, reason }),
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setPageError(json?.error || "Could not cancel trip. Please try again.");
      return;
    }

    await loadAll();
  }

  if (loading) {
    return (
      <main className="space-y-6 text-black">
        <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
          <p className="text-gray-700">Loading trip.</p>
        </section>
      </main>
    );
  }

  if (!trip) {
    return (
      <main className="space-y-6 text-black">
        {pageError && (
          <CenteredMessageBox
            title="Could not load trip"
            message={pageError}
            onClose={() => setPageError(null)}
          />
        )}
        <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
          <p className="text-black">Trip not found.</p>
          <button
            className="mt-4 rounded-xl px-4 py-2 text-white"
            style={{ background: "var(--moovu-primary)" }}
            onClick={() => router.push("/admin/trips")}
          >
            Back to Trips
          </button>
        </section>
      </main>
    );
  }

  const isClosed = trip.status === "completed" || trip.status === "cancelled";

  return (
    <main className="space-y-6 text-black">
      {pageError && (
        <CenteredMessageBox
          title="Trip action failed"
          message={pageError}
          onClose={() => setPageError(null)}
        />
      )}
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="text-sm text-gray-500">Trip Detail</div>
          <h1 className="text-3xl font-semibold text-black mt-1">Trip</h1>
          <p className="text-gray-700 mt-2">
            Status: <span className="capitalize font-medium text-black">{trip.status}</span>
            {trip.cancel_reason ? ` • Reason: ${trip.cancel_reason}` : ""}
          </p>
        </div>

        <button
          className="rounded-xl px-4 py-2 text-white"
          style={{ background: "var(--moovu-primary)" }}
          onClick={() => router.push("/admin/trips")}
        >
          Back to Trips
        </button>
      </div>

      <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border rounded-2xl p-4" style={{ background: "var(--moovu-primary-soft)" }}>
            <div className="text-sm text-gray-600">Pickup</div>
            <div className="font-medium text-black mt-1">{trip.pickup_address}</div>
          </div>

          <div className="border rounded-2xl p-4 bg-white">
            <div className="text-sm text-gray-600">Dropoff</div>
            <div className="font-medium text-black mt-1">{trip.dropoff_address}</div>
          </div>
        </div>

        {tripStops.length > 0 && (
          <div className="rounded-3xl border border-blue-100 bg-blue-50 p-4">
            <div className="text-sm font-black uppercase tracking-[0.12em] text-blue-700">Route stops</div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {tripStops.map((stop, index) => (
                <div key={`${stop.address}-${index}`} className="rounded-2xl bg-white p-4">
                  <div className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">Stop {index + 1}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950">{stop.address}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {trip.final_add_stop_increase != null && Number(trip.final_add_stop_increase) > 0 && (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">Original fare</div>
              <div className="font-semibold text-black mt-1">R{Number(trip.original_fare ?? 0).toFixed(2)}</div>
            </div>
            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">Add stop increase</div>
              <div className="font-semibold text-black mt-1">R{Number(trip.final_add_stop_increase ?? 0).toFixed(2)}</div>
            </div>
            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">Waiting fees</div>
              <div className="font-semibold text-black mt-1">R{Number(trip.stop_waiting_fee ?? 0).toFixed(2)}</div>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-4">
          <div className="border rounded-2xl p-4 bg-white">
            <div className="text-sm text-gray-600">Customer</div>
            <div className="font-semibold text-black mt-1">{trip.rider_name ?? "Customer"}</div>
            <div className="mt-1 text-sm font-bold text-slate-600">
              {trip.rider_phone ?? "Cellphone not captured"}
            </div>
          </div>

          <div className="border rounded-2xl p-4 bg-white">
            <div className="text-sm text-gray-600">Driver</div>
            <div className="font-semibold text-black mt-1">{driverLabel}</div>
            {trip.offer_status === "pending" && offerSecondsLeft != null && (
              <div className="text-sm text-gray-700 mt-2">
                Offer pending • {Math.max(0, offerSecondsLeft)}s left
              </div>
            )}
          </div>

          <div className="border rounded-2xl p-4 bg-white">
            <div className="text-sm text-gray-600">Payment</div>
            <div className="font-semibold text-black mt-1 capitalize">{trip.payment_method}</div>
          </div>

          <div className="border rounded-2xl p-4 bg-white">
            <div className="text-sm text-gray-600">Fare</div>
            <div className="font-semibold text-black mt-1">
              {trip.fare_amount != null ? `R${trip.fare_amount}` : "—"}
            </div>
          </div>

          <div className="border rounded-2xl p-4 bg-white">
            <div className="text-sm text-gray-600">Offer</div>
            <div className="font-semibold text-black mt-1">{trip.offer_status ?? "—"}</div>
          </div>
        </div>
      </section>

      <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
        <div className="flex flex-wrap gap-2">
          {!isClosed && trip.offer_status !== "pending" && trip.status !== "assigned" && (
            <button
              className="rounded-xl px-4 py-2 text-white"
              style={{ background: "var(--moovu-primary)" }}
              onClick={() => offerNearest([])}
            >
              Offer nearest driver
            </button>
          )}

          {!isClosed && (
            <button
              className="border rounded-xl px-4 py-2 bg-white text-black"
              onClick={cancelTrip}
            >
              Cancel
            </button>
          )}
        </div>
      </section>

      <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
        <h2 className="text-xl font-semibold text-black">Events</h2>
        <div className="mt-4 space-y-3">
          {events.map((e) => (
            <div key={e.id} className="border rounded-xl p-4">
              <div className="font-medium">{e.event_type}</div>
              {e.message && <div className="text-sm text-gray-700 mt-2">{e.message}</div>}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
