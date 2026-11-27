"use client";
import LoadingState from "@/components/ui/LoadingState";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";
import { adminDriverName } from "@/lib/admin/identity";
import { isDispatchExpired } from "@/lib/dispatch/config";
import Phase4FinancePanel from "@/components/admin/Phase4FinancePanel";
import TripDispatchActions from "@/components/admin/TripDispatchActions";

type Trip = {
  id: string;
  driver_id: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string;
  dropoff_address: string;
  payment_method: string;
  fare_amount: number | null;
  estimated_fare?: number | null;
  fare_adjustment_amount?: number | null;
  status: string;
  cancel_reason: string | null;
  created_at: string;
  scheduled_for?: string | null;
  dispatch_started_at?: string | null;
  driver_arrived_at?: string | null;
  trip_started_at?: string | null;
  cancelled_at?: string | null;
  offer_status: string | null;
  offer_expires_at: string | null;
  stops?: unknown;
  original_fare?: number | null;
  final_add_stop_increase?: number | null;
  final_fare?: number | null;
  stop_waiting_fee?: number | null;
  actual_distance_km?: number | null;
  actual_duration_min?: number | null;
  start_otp_verified?: boolean | null;
  end_otp_verified?: boolean | null;
  completed_without_end_otp?: boolean | null;
  end_otp_bypass_reason?: string | null;
  end_otp_bypass_note?: string | null;
  completed_by?: string | null;
  completed_at?: string | null;
  admin_completion_reason?: string | null;
  admin_completion_note?: string | null;
  cancellation_fee_amount?: number | null;
  cancellation_driver_amount?: number | null;
  cancellation_moovu_amount?: number | null;
  commission_pct?: number | null;
  commission_amount?: number | null;
  driver_net_earnings?: number | null;
  dispatch_state?: string | null;
  dispatch_failure_reason?: string | null;
  cancellation_reason?: string | null;
  cancelled_by?: string | null;
  actual_fare_breakdown?: {
    distanceDiscountPct?: number;
    distanceDiscountAmount?: number;
    fareBeforeDistanceDiscount?: number;
  } | null;
  fare_breakdown?: {
    journeyFare?: {
      distanceDiscountPct?: number;
      distanceDiscountAmount?: number;
      fareBeforeDistanceDiscount?: number;
    };
  } | null;
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

type TripOffer = { id: string; driver_id: string; status: string; dispatch_cycle: number | null; sequence_number: number | null; offered_at: string | null; responded_at: string | null; accept_deadline_at: string | null; decline_reason: string | null; response_source: string | null };

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
  const [offers, setOffers] = useState<TripOffer[]>([]);
  const [contextErrors, setContextErrors] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [offering, setOffering] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completionNote, setCompletionNote] = useState("");
  const [completing, setCompleting] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pageError, setPageError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "money" | "dispatch" | "timeline">("overview");
  const loadSequence = useRef(0);

  const loadAll = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setPageError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session?.access_token) throw new Error("Please sign in as an admin to view trip details.");
      const res = await fetch(`/api/admin/trips/${encodeURIComponent(tripId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Could not load trip details. Please refresh or contact admin support.");
      if (sequence !== loadSequence.current) return;
      setTrip((json.trip as Trip | null) ?? null);
      setEvents(Array.isArray(json.events) ? json.events : []);
      setDrivers(Array.isArray(json.drivers) ? json.drivers : []);
      setOffers(Array.isArray(json.offers) ? json.offers : []);
      setContextErrors(json.context_errors && typeof json.context_errors === "object" ? json.context_errors : {});
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setTrip(null);
      setEvents([]);
      setDrivers([]);
      setOffers([]);
      setContextErrors({});
      setPageError(error instanceof DOMException && error.name === "AbortError"
        ? "The trip request timed out. Please retry."
        : error instanceof Error ? error.message : "Could not load trip details.");
    } finally {
      window.clearTimeout(timeout);
      if (sequence === loadSequence.current) setLoading(false);
    }
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
    ? `${adminDriverName(assignedDriver)}${assignedDriver.phone ? ` (${assignedDriver.phone})` : ""}`
    : driverId
      ? "Driver profile unavailable"
      : "Unassigned";
  const tripStops = parseTripStops(trip?.stops);
  const offerSecondsLeft = trip?.offer_expires_at
    ? Math.ceil((new Date(trip.offer_expires_at).getTime() - nowMs) / 1000)
    : null;
  const tripStartedAt =
    events.find((event) => event.event_type === "trip_started")?.created_at ?? null;
  const distanceFareBreakdown =
    trip?.actual_fare_breakdown ?? trip?.fare_breakdown?.journeyFare ?? null;

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
    return <LoadingState title="Getting your trip ready..." />;
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
  const tripHeadline = ({
    requested: "Waiting for a driver to accept.",
    offered: "Offered to a driver, waiting for an answer.",
    assigned: "Driver is on the way to the pickup.",
    arrived: "Driver has arrived at the pickup.",
    ongoing: "Trip is in progress.",
    completed: `Completed${trip.completed_at ? ` at ${new Date(trip.completed_at).toLocaleString("en-ZA")}` : ""}.`,
    cancelled: "This trip was cancelled.",
    scheduled: `Scheduled for ${trip.scheduled_for ? new Date(trip.scheduled_for).toLocaleString("en-ZA") : "later"}.`,
  } as Record<string, string>)[trip.status] ?? trip.status;
  const dispatchWindowExpired = isDispatchExpired(trip.created_at, nowMs);
  const hasActiveOffer =
    trip.offer_status === "pending" &&
    offerSecondsLeft != null &&
    offerSecondsLeft > 0;
  const canOfferNearest =
    !isClosed &&
    !trip.driver_id &&
    ["requested", "offered"].includes(trip.status) &&
    !hasActiveOffer &&
    !dispatchWindowExpired;

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
              <div><strong>Current status:</strong> <span className="capitalize">{trip.status}</span></div>
              <div><strong>Started:</strong> {tripStartedAt ? new Date(tripStartedAt).toLocaleString() : "--"}</div>
              <div><strong>Tracked:</strong> {Number(trip.actual_distance_km ?? 0).toFixed(2)} km / {Number(trip.actual_duration_min ?? 0).toFixed(0)} min</div>
              <div><strong>Initial fare:</strong> R{Number(trip.estimated_fare ?? trip.fare_amount ?? 0).toFixed(2)}</div>
              <div><strong>Stop additions:</strong> R{Number(trip.fare_adjustment_amount ?? 0).toFixed(2)}</div>
              <div><strong>Trip fare:</strong> R{Number(trip.final_fare ?? trip.fare_amount ?? 0).toFixed(2)}</div>
              <div><strong>Start OTP:</strong> {trip.start_otp_verified ? "Verified" : "Not verified"}</div>
              <div><strong>End OTP:</strong> {trip.end_otp_verified ? "Verified" : "Not verified"}</div>
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
      <div className="ad-page">
        <header className="ad-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <button type="button" className="ad-note mb-1 font-bold" onClick={() => router.push("/admin/trips")}>← Trips</button>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">{trip.rider_name || "Customer"}</h1>
                <StatusBadge status={trip.status} />
              </div>
              <p className="ad-note mt-1">{tripHeadline}</p>
              <p className="ad-note mt-1">Booked {new Date(trip.created_at).toLocaleString("en-ZA")} · Ref <span className="font-mono text-xs">{trip.id.slice(0, 8)}</span></p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-black">R{Number(trip.final_fare ?? trip.fare_amount ?? 0).toFixed(2)}</div>
              <div className="ad-note">{trip.payment_method === "online" ? "Card" : "Cash"}</div>
            </div>
          </div>
          <div className="ad-row-actions mt-4" style={{ justifyContent: "flex-start" }}>
            {canOfferNearest && <TripDispatchActions tripId={trip.id} onDone={() => void loadAll()} />}
            {canOfferNearest && trip.offer_status === "pending" && (
              <button type="button" className="ad-btn" disabled={offering} onClick={() => offerNearest([])}>{offering ? "Finding…" : "Offer next driver"}</button>
            )}
            {!isClosed && !trip.driver_id && dispatchWindowExpired && <span className="ad-badge is-off">Dispatch window expired (30 min)</span>}
            {trip.status === "ongoing" && <button type="button" className="ad-btn is-primary" onClick={() => setCompleteOpen(true)}>Complete trip</button>}
            {trip.status === "completed" && <Link className="ad-btn" href={`/admin/receipts/${trip.id}`}>Receipt</Link>}
            {!isClosed && <button type="button" className="ad-btn" style={{ color: "#b91c1c" }} onClick={cancelTrip}>Cancel trip</button>}
          </div>
        </header>

        <div className="ad-tabs" role="tablist" aria-label="Trip sections">
          {(["overview", "money", "dispatch", "timeline"] as const).map(t => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>
              {{ overview: "Overview", money: "Money", dispatch: "Driver offers", timeline: "Timeline" }[t]}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="grid gap-4 md:grid-cols-2">
            <section className="ad-card">
              <div className="ad-card-head"><h2>Route</h2></div>
              <ol className="space-y-3 text-sm">
                <li><span className="ad-badge is-live">Pickup</span><div className="mt-1 font-semibold">{trip.pickup_address}</div></li>
                {tripStops.map((stop, i) => <li key={i}><span className="ad-badge">Stop {i + 1}</span><div className="mt-1 font-semibold">{stop.address}</div></li>)}
                <li><span className="ad-badge is-done">Drop-off</span><div className="mt-1 font-semibold">{trip.dropoff_address}</div></li>
              </ol>
              {(trip.actual_distance_km || trip.actual_duration_min) ? (
                <p className="ad-note mt-3">Tracked {Number(trip.actual_distance_km ?? 0).toFixed(1)} km · {Number(trip.actual_duration_min ?? 0).toFixed(0)} min</p>
              ) : null}
            </section>
            <section className="ad-card space-y-3">
              <div className="ad-card-head"><h2>People</h2></div>
              <div className="ad-row">
                <div><div className="ad-row-title">{trip.rider_name || "Customer"}</div><div className="ad-row-sub">Customer · {trip.rider_phone || "no phone"}</div></div>
                {trip.rider_phone && <div className="ad-row-actions"><a className="ad-btn" href={`tel:${trip.rider_phone}`}>Call</a></div>}
              </div>
              <div className="ad-row">
                <div><div className="ad-row-title">{assignedDriver ? adminDriverName(assignedDriver) : trip.driver_id ? "Driver" : "No driver yet"}</div>
                  <div className="ad-row-sub">Driver{assignedDriver?.phone ? ` · ${assignedDriver.phone}` : ""}</div></div>
                <div className="ad-row-actions">
                  {assignedDriver?.phone && <a className="ad-btn" href={`tel:${assignedDriver.phone}`}>Call</a>}
                  {trip.driver_id && <Link className="ad-btn" href={`/admin/drivers/${trip.driver_id}`}>Profile</Link>}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div><dt className="ad-note">Start code</dt><dd className="font-semibold">{trip.start_otp_verified ? "Verified" : "Not verified"}</dd></div>
                <div><dt className="ad-note">End code</dt><dd className="font-semibold">{trip.end_otp_verified ? "Verified" : trip.completed_without_end_otp ? "Skipped" : "Not verified"}</dd></div>
              </dl>
              {trip.completed_without_end_otp && <p className="ad-note">Ended without code: {trip.end_otp_bypass_reason ?? "no reason"}{trip.end_otp_bypass_note ? ` — ${trip.end_otp_bypass_note}` : ""}</p>}
              {trip.admin_completion_note && <p className="ad-note">Completed by admin: {trip.admin_completion_note}</p>}
              {trip.status === "cancelled" && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">Cancelled{trip.cancelled_by ? ` by ${trip.cancelled_by}` : ""}{trip.cancelled_at ? ` at ${new Date(trip.cancelled_at).toLocaleString("en-ZA")}` : ""}. {trip.cancel_reason ?? trip.cancellation_reason ?? ""}</p>}
            </section>
          </div>
        )}

        {tab === "money" && (
          <div className="space-y-4">
            <section className="ad-card">
              <div className="ad-card-head"><h2>Fare</h2></div>
              <dl className="space-y-2 text-sm">
                {[
                  ["Quoted fare", trip.estimated_fare ?? trip.original_fare ?? trip.fare_amount],
                  ["Added stops", trip.final_add_stop_increase ?? trip.fare_adjustment_amount],
                  ["Stop waiting", trip.stop_waiting_fee],
                  ["Final fare", trip.final_fare ?? trip.fare_amount],
                  ["MOOVU commission", trip.commission_amount],
                  ["Driver earns", trip.driver_net_earnings],
                  ["Cancellation fee", trip.cancellation_fee_amount],
                ].filter(([, v]) => v !== null && v !== undefined && Number(v) !== 0).map(([label, v]) => (
                  <div key={String(label)} className="flex justify-between gap-3"><dt className="ad-note">{label}</dt><dd className="font-bold">R{Number(v).toFixed(2)}</dd></div>
                ))}
              </dl>
              {distanceFareBreakdown?.distanceDiscountAmount ? (
                <p className="ad-note mt-3">Includes a {distanceFareBreakdown.distanceDiscountPct}% long-trip discount (R{Number(distanceFareBreakdown.distanceDiscountAmount).toFixed(2)}).</p>
              ) : null}
            </section>
            <Phase4FinancePanel tripId={tripId} />
          </div>
        )}

        {tab === "dispatch" && (
          <section className="ad-card">
            <div className="ad-card-head"><h2>Driver offers</h2></div>
            {contextErrors.offers ? <p className="ad-empty">{contextErrors.offers}</p> : offers.length === 0 ? <p className="ad-empty">This trip was never offered to a driver.</p> : (
              <div className="ad-rows">
                {offers.map(offer => {
                  const d = drivers.find(x => x.id === offer.driver_id);
                  return (
                    <div key={offer.id} className="ad-row">
                      <div><div className="ad-row-title">{d ? adminDriverName(d) : "Driver"}</div>
                        <div className="ad-row-sub">Offered {offer.offered_at ? new Date(offer.offered_at).toLocaleTimeString("en-ZA") : "?"}{offer.responded_at ? ` · answered ${new Date(offer.responded_at).toLocaleTimeString("en-ZA")}` : ""}{offer.decline_reason ? ` · ${offer.decline_reason}` : ""}</div></div>
                      <span className={`ad-badge ${offer.status === "accepted" ? "is-done" : offer.status === "pending" ? "is-waiting" : "is-off"}`}>{offer.status}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {trip.dispatch_failure_reason && <p className="ad-note mt-3">Why no driver: {trip.dispatch_failure_reason}</p>}
          </section>
        )}

        {tab === "timeline" && (
          <section className="ad-card">
            <div className="ad-card-head"><h2>Timeline</h2></div>
            {contextErrors.events && <p className="ad-empty">{contextErrors.events}</p>}
            <ol className="space-y-2">
              {events.map(e => (
                <li key={e.id} className="ad-row" style={{ gridTemplateColumns: "1fr" }}>
                  <div>
                    <div className="ad-row-title capitalize">{e.event_type.replaceAll("_", " ")}</div>
                    <div className="ad-row-sub">{new Date(e.created_at).toLocaleString("en-ZA")}{e.message ? ` · ${drivers.reduce((m, d) => m.replaceAll(d.id, adminDriverName(d)), e.message)}` : ""}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </main>
  );
}
