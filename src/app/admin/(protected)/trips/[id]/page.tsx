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
  dispatch_started_at?: string | null;
  dispatch_cycle?: number | null;
  auto_cancel_at?: string | null;
  cancellation_reason?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
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

type Offer = {
  id: string;
  driver_id: string;
  status: string;
  dispatch_cycle: number;
  offered_at: string;
  accept_deadline_at: string;
};

type OtpStatus = { startAvailable: boolean; endAvailable: boolean; startVerified: boolean; endVerified: boolean };

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
  const [offers, setOffers] = useState<Offer[]>([]);
  const [otpStatus, setOtpStatus] = useState<OtpStatus | null>(null);
  const [revealedOtp, setRevealedOtp] = useState<{ startOtp: string | null; endOtp: string | null } | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [completionReason, setCompletionReason] = useState("Driver forgot to complete trip");
  const [completionNote, setCompletionNote] = useState("");
  const [completionFare, setCompletionFare] = useState("");
  const [completing, setCompleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offering, setOffering] = useState(false);
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
    setOffers((json.offers as Offer[] | null) ?? []);
    setOtpStatus((json.otp as OtpStatus | null) ?? null);
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

  async function revealOtp() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch(`/api/admin/trips/${encodeURIComponent(tripId)}/otp`, {
      method: "POST",
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) return setPageError(json?.error || "Could not reveal OTPs.");
    setRevealedOtp({ startOtp: json.startOtp, endOtp: json.endOtp });
  }

  async function completeTrip() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    setCompleting(true);
    const res = await fetch("/api/admin/trips/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ tripId, reason: completionReason, note: completionNote, finalFare: Number(completionFare) }),
    });
    const json = await res.json().catch(() => null);
    setCompleting(false);
    if (!res.ok || !json?.ok) return setPageError(json?.error || "Could not complete trip.");
    setShowComplete(false);
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
  const currentRound = Math.max(Number(trip.dispatch_cycle ?? 0), ...offers.map((offer) => offer.dispatch_cycle), 0);
  const currentOffers = offers.filter((offer) => offer.dispatch_cycle === currentRound);
  const dispatchDeadline = trip.auto_cancel_at ?? (trip.dispatch_started_at
    ? new Date(new Date(trip.dispatch_started_at).getTime() + 300_000).toISOString()
    : null);

  return (
    <main className="space-y-6 text-black">
      {pageError && (
        <CenteredMessageBox
          title="Trip action failed"
          message={pageError}
          onClose={() => setPageError(null)}
        />
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
        </div>
      </section>

      <section className="moovu-card p-5 sm:p-6">
        <div className="moovu-section-title">Dispatch</div>
        <h2 className="mt-2 text-xl font-black text-slate-950">Offer rounds</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="moovu-data-row"><div className="text-sm text-gray-600">Started</div><div className="mt-1 font-semibold">{trip.dispatch_started_at ? new Date(trip.dispatch_started_at).toLocaleString() : "—"}</div></div>
          <div className="moovu-data-row"><div className="text-sm text-gray-600">Current round</div><div className="mt-1 font-semibold">{currentRound || "—"}</div></div>
          <div className="moovu-data-row"><div className="text-sm text-gray-600">Eligible / offered</div><div className="mt-1 font-semibold">{currentOffers.length} / {offers.length}</div></div>
          <div className="moovu-data-row"><div className="text-sm text-gray-600">Auto-cancel deadline</div><div className="mt-1 font-semibold">{dispatchDeadline ? new Date(dispatchDeadline).toLocaleString() : "—"}</div></div>
          {[["Accepted", "accepted"], ["Declined", "declined"], ["Timed out", "expired"]].map(([label, status]) => (
            <div className="moovu-data-row" key={status}><div className="text-sm text-gray-600">{label}</div><div className="mt-1 font-semibold">{offers.filter((offer) => offer.status === status).length}</div></div>
          ))}
          <div className="moovu-data-row"><div className="text-sm text-gray-600">Next round</div><div className="mt-1 font-semibold">{currentOffers[0]?.accept_deadline_at ? new Date(currentOffers[0].accept_deadline_at).toLocaleTimeString() : "—"}</div></div>
        </div>
      </section>

      <section className="moovu-card p-5 sm:p-6">
        <div className="moovu-section-title">Secure OTP</div>
        <h2 className="mt-2 text-xl font-black text-slate-950">Trip verification</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="moovu-data-row"><div className="text-sm text-gray-600">Start OTP</div><div className="mt-1 text-2xl font-black tracking-[0.25em]">{revealedOtp?.startOtp ?? "••••"}</div><div className="mt-2 text-sm">{otpStatus?.startVerified ? "Verified" : "Unused"}</div></div>
          <div className="moovu-data-row"><div className="text-sm text-gray-600">End OTP</div><div className="mt-1 text-2xl font-black tracking-[0.25em]">{revealedOtp?.endOtp ?? "••••"}</div><div className="mt-2 text-sm">{otpStatus?.endVerified ? "Verified" : trip.status === "ongoing" ? "Available" : "Locked"}</div></div>
        </div>
        {!revealedOtp && <button className="moovu-btn moovu-btn-secondary mt-4" onClick={revealOtp}>Reveal OTPs</button>}
      </section>

      {trip.status === "ongoing" && (
        <section className="moovu-card p-5 sm:p-6">
          <div className="moovu-section-title">Recovery action</div>
          <h2 className="mt-2 text-xl font-black text-slate-950">Complete an active trip safely</h2>
          <p className="mt-2 text-sm text-gray-700">Use only after support has confirmed the trip ended. The override is audited.</p>
          <button className="moovu-btn moovu-btn-primary mt-4" onClick={() => { setCompletionFare(String(trip.final_fare ?? trip.fare_amount ?? "")); setShowComplete(true); }}>Complete Trip</button>
        </section>
      )}

      {showComplete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="moovu-card w-full max-w-lg space-y-4 p-6">
            <div><div className="moovu-section-title">Confirm recovery</div><h2 className="mt-2 text-2xl font-black">Complete Trip</h2></div>
            <label className="block text-sm font-bold">Reason<select className="mt-2 w-full rounded-2xl border p-3" value={completionReason} onChange={(e) => setCompletionReason(e.target.value)}>{["Driver forgot to complete trip", "Driver app issue", "Customer confirmed trip ended", "Support-assisted completion", "Other"].map((reason) => <option key={reason}>{reason}</option>)}</select></label>
            <label className="block text-sm font-bold">Final fare<input className="mt-2 w-full rounded-2xl border p-3" type="number" min="1" step="0.01" value={completionFare} onChange={(e) => setCompletionFare(e.target.value)} /></label>
            <label className="block text-sm font-bold">Internal note{completionReason === "Other" ? " (required)" : " (optional)"}<textarea className="mt-2 w-full rounded-2xl border p-3" value={completionNote} onChange={(e) => setCompletionNote(e.target.value)} /></label>
            <div className="flex gap-3"><button className="moovu-btn moovu-btn-secondary" onClick={() => setShowComplete(false)}>Back</button><button className="moovu-btn moovu-btn-primary" disabled={completing} onClick={completeTrip}>{completing ? "Completing…" : "Confirm completion"}</button></div>
          </div>
        </div>
      )}

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
