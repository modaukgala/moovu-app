"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import StatusBadge from "@/components/ui/StatusBadge";
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
  current_fare?: number | null;
  actual_distance_km?: number | null;
  actual_duration_min?: number | null;
  start_otp?: string | null;
  end_otp?: string | null;
  start_otp_verified?: boolean | null;
  end_otp_verified?: boolean | null;
  completed_without_end_otp?: boolean | null;
  end_otp_bypass_reason?: string | null;
  end_otp_bypass_note?: string | null;
  completed_by?: string | null;
  completed_at?: string | null;
  cancellation_fee_amount?: number | null;
  cancellation_driver_amount?: number | null;
  cancellation_moovu_amount?: number | null;
  cancellation_reason?: string | null;
  cancelled_by?: string | null;
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
  const [offering, setOffering] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completionNote, setCompletionNote] = useState("");
  const [completing, setCompleting] = useState(false);
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
  const tripStartedAt =
    events.find((event) => event.event_type === "trip_started")?.created_at ?? null;

  async function offerNearest(exclude: string[] = []) {
    if (!trip) return;

    setOffering(true);
    setPageError(null);

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

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setOffering(false);
      setPageError(json?.error || "Offer failed");
      return;
    }

    await loadAll();
    setOffering(false);
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

  async function completeTrip() {
    if (!trip || completionNote.trim().length < 3) return;
    setCompleting(true);
    setPageError(null);
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    const response = await fetch("/api/admin/trips/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ tripId: trip.id, note: completionNote.trim() }),
    });
    const json = await response.json().catch(() => null);
    setCompleting(false);
    if (!response.ok || !json?.ok) {
      setPageError(json?.error || "Could not complete this trip.");
      return;
    }
    setCompleteOpen(false);
    setCompletionNote("");
    await loadAll();
  }

  if (loading) {
    return (
      <main className="space-y-6 text-black">
        <section className="moovu-card p-5 sm:p-6">
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
        <section className="moovu-card p-5 sm:p-6">
          <p className="text-black">Trip not found.</p>
          <button
            className="mt-4 moovu-btn moovu-btn-primary"
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
  const hasActiveOffer =
    trip.offer_status === "pending" &&
    offerSecondsLeft != null &&
    offerSecondsLeft > 0;
  const canOfferNearest =
    !isClosed &&
    !trip.driver_id &&
    ["requested", "offered"].includes(trip.status) &&
    !hasActiveOffer;

  return (
    <main className="space-y-6 text-black">
      {pageError && (
        <CenteredMessageBox
          title="Trip action failed"
          message={pageError}
          onClose={() => setPageError(null)}
        />
      )}
      {completeOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/55 p-4">
          <section className="w-full max-w-lg rounded-[28px] bg-white p-5 shadow-2xl sm:p-6">
            <div className="moovu-section-title">Admin trip completion</div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Complete Trip</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              This uses the same fare, earnings, commission, receipt, driver-release, and notification flow as driver completion.
            </p>
            <div className="mt-4 grid gap-2 rounded-2xl bg-slate-50 p-4 text-sm">
              <div><strong>Customer:</strong> {trip.rider_name ?? "Customer"}</div>
              <div><strong>Driver:</strong> {driverLabel}</div>
              <div><strong>Pickup:</strong> {trip.pickup_address}</div>
              <div><strong>Destination:</strong> {trip.dropoff_address}</div>
              <div><strong>Started:</strong> {tripStartedAt ? new Date(tripStartedAt).toLocaleString() : "--"}</div>
              <div><strong>Tracked:</strong> {Number(trip.actual_distance_km ?? 0).toFixed(2)} km / {Number(trip.actual_duration_min ?? 0).toFixed(0)} min</div>
              <div><strong>Current fare:</strong> R{Number(trip.current_fare ?? trip.final_fare ?? trip.fare_amount ?? 0).toFixed(2)}</div>
            </div>
            <textarea
              className="moovu-input mt-4 min-h-24 resize-y"
              value={completionNote}
              onChange={(event) => setCompletionNote(event.target.value)}
              placeholder="Why is admin completing this trip?"
              maxLength={240}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="moovu-btn moovu-btn-primary"
                disabled={completing || completionNote.trim().length < 3}
                onClick={() => void completeTrip()}
              >
                {completing ? "Completing..." : "Confirm completion"}
              </button>
              <button
                type="button"
                className="moovu-btn moovu-btn-secondary"
                disabled={completing}
                onClick={() => setCompleteOpen(false)}
              >
                Keep trip open
              </button>
            </div>
          </section>
        </div>
      )}
      <header className="moovu-card flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div>
          <div className="moovu-section-title">Trip control room</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-black text-slate-950">Trip details</h1>
            <StatusBadge status={trip.status} />
          </div>
          <p className="text-gray-700 mt-2">
            Status: <span className="capitalize font-medium text-black">{trip.status}</span>
            {trip.cancel_reason ? ` • Reason: ${trip.cancel_reason}` : ""}
          </p>
        </div>

        <button
          className="moovu-btn moovu-btn-secondary"
          onClick={() => router.push("/admin/trips")}
        >
          Back to Trips
        </button>
      </header>

      <section className="moovu-card space-y-4 p-5 sm:p-6">
        <div>
          <div className="moovu-section-title">Route and assignment</div>
          <h2 className="mt-2 text-xl font-black text-slate-950">Trip summary</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="moovu-data-row" style={{ background: "var(--moovu-primary-soft)" }}>
            <div className="text-sm text-gray-600">Pickup</div>
            <div className="font-medium text-black mt-1">{trip.pickup_address}</div>
          </div>

          <div className="moovu-data-row">
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
            <div className="moovu-data-row">
              <div className="text-sm text-gray-600">Original fare</div>
              <div className="font-semibold text-black mt-1">R{Number(trip.original_fare ?? 0).toFixed(2)}</div>
            </div>
            <div className="moovu-data-row">
              <div className="text-sm text-gray-600">Add stop increase</div>
              <div className="font-semibold text-black mt-1">R{Number(trip.final_add_stop_increase ?? 0).toFixed(2)}</div>
            </div>
            <div className="moovu-data-row">
              <div className="text-sm text-gray-600">Waiting fees</div>
              <div className="font-semibold text-black mt-1">R{Number(trip.stop_waiting_fee ?? 0).toFixed(2)}</div>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-4">
          <div className="moovu-data-row">
            <div className="text-sm text-gray-600">Customer</div>
            <div className="font-semibold text-black mt-1">{trip.rider_name ?? "Customer"}</div>
            <div className="mt-1 text-sm font-bold text-slate-600">
              {trip.rider_phone ?? "Cellphone not captured"}
            </div>
          </div>

          <div className="moovu-data-row">
            <div className="text-sm text-gray-600">Driver</div>
            <div className="font-semibold text-black mt-1">{driverLabel}</div>
            {hasActiveOffer && offerSecondsLeft != null && (
              <div className="text-sm text-gray-700 mt-2">
                Offer pending • {Math.max(0, offerSecondsLeft)}s left
              </div>
            )}
            {trip.offer_status === "pending" && !hasActiveOffer && (
              <div className="mt-2 text-sm font-bold text-amber-700">
                Previous offer ended. Offer the next eligible driver.
              </div>
            )}
          </div>

          <div className="moovu-data-row">
            <div className="text-sm text-gray-600">Payment</div>
            <div className="font-semibold text-black mt-1 capitalize">{trip.payment_method}</div>
          </div>

          <div className="moovu-data-row">
            <div className="text-sm text-gray-600">Fare</div>
            <div className="font-semibold text-black mt-1">
              {trip.fare_amount != null ? `R${trip.fare_amount}` : "—"}
            </div>
          </div>

          <div className="moovu-data-row">
            <div className="text-sm text-gray-600">Offer</div>
            <div className="font-semibold text-black mt-1">{trip.offer_status ?? "—"}</div>
          </div>
        </div>
      </section>

      <section className="moovu-card p-5 sm:p-6">
        <div className="moovu-section-title">Trip security and accounting</div>
        <h2 className="mt-2 text-xl font-black text-slate-950">Security, fare and cancellation</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="moovu-data-row">
            <div className="text-sm text-gray-600">Start OTP</div>
            <div className="mt-1 text-2xl font-black tracking-[0.2em]">{trip.start_otp ?? "--"}</div>
            <div className="mt-1 text-xs font-bold text-slate-500">{trip.start_otp_verified ? "Verified" : "Not verified"}</div>
          </div>
          <div className="moovu-data-row">
            <div className="text-sm text-gray-600">End OTP</div>
            <div className="mt-1 text-2xl font-black tracking-[0.2em]">{trip.end_otp ?? "--"}</div>
            <div className="mt-1 text-xs font-bold text-slate-500">
              {trip.completed_without_end_otp ? "Not used - driver bypass" : trip.end_otp_verified ? "Verified" : "Not verified"}
            </div>
          </div>
          <div className="moovu-data-row">
            <div className="text-sm text-gray-600">Completion</div>
            <div className="mt-1 font-black capitalize">{trip.completed_by ?? "--"}</div>
            {trip.end_otp_bypass_reason && <div className="mt-1 text-sm text-amber-700">{trip.end_otp_bypass_reason}</div>}
            {trip.end_otp_bypass_note && <div className="mt-1 text-xs text-slate-600">{trip.end_otp_bypass_note}</div>}
          </div>
          <div className="moovu-data-row">
            <div className="text-sm text-gray-600">Live / final fare</div>
            <div className="mt-1 text-xl font-black">R{Number(trip.current_fare ?? trip.final_fare ?? trip.fare_amount ?? 0).toFixed(2)}</div>
            <div className="mt-1 text-xs text-slate-500">{Number(trip.actual_distance_km ?? 0).toFixed(2)} km / {Number(trip.actual_duration_min ?? 0).toFixed(0)} min</div>
          </div>
        </div>
        {Number(trip.cancellation_fee_amount ?? 0) > 0 && (
          <div className="mt-4 grid gap-3 rounded-2xl bg-amber-50 p-4 sm:grid-cols-4">
            <div><div className="text-xs font-bold text-amber-700">Cancellation fee</div><strong>R{Number(trip.cancellation_fee_amount).toFixed(2)}</strong></div>
            <div><div className="text-xs font-bold text-amber-700">MOOVU share</div><strong>R{Number(trip.cancellation_moovu_amount ?? 0).toFixed(2)}</strong></div>
            <div><div className="text-xs font-bold text-amber-700">Driver credit</div><strong>R{Number(trip.cancellation_driver_amount ?? 0).toFixed(2)}</strong></div>
            <div><div className="text-xs font-bold text-amber-700">Commission effect</div><strong>-R{Number(trip.cancellation_driver_amount ?? 0).toFixed(2)}</strong></div>
          </div>
        )}
      </section>

      <section className="moovu-card p-5 sm:p-6">
        <div className="moovu-action-row">
          {canOfferNearest && (
            <button
              className="moovu-btn moovu-btn-primary"
              disabled={offering}
              onClick={() => offerNearest([])}
            >
              {offering
                ? "Finding next driver..."
                : trip.offer_status === "pending"
                  ? "Offer next driver"
                  : "Offer nearest driver"}
            </button>
          )}

          {!isClosed && (
            <button
              className="moovu-btn moovu-btn-danger"
              onClick={cancelTrip}
            >
              Cancel
            </button>
          )}
          {trip.status === "ongoing" && (
            <button
              className="moovu-btn bg-emerald-600 text-white"
              onClick={() => setCompleteOpen(true)}
            >
              Complete Trip
            </button>
          )}
        </div>
      </section>

      <section className="moovu-card p-5 sm:p-6">
        <div className="moovu-section-title">Activity</div>
        <h2 className="mt-2 text-xl font-black text-slate-950">Trip timeline</h2>
        <div className="mt-4 space-y-3">
          {events.map((e) => (
            <div key={e.id} className="moovu-data-row">
              <div className="font-black capitalize text-slate-950">{e.event_type.replaceAll("_", " ")}</div>
              {e.message && <div className="text-sm text-gray-700 mt-2">{e.message}</div>}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
