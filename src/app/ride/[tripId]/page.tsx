"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import LoadingState from "@/components/ui/LoadingState";
import { supabaseClient } from "@/lib/supabase/client";

type RideTrip = {
  id: string;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  fare_amount: number | null;
  payment_method: string | null;
  driver_id: string | null;
  created_at?: string | null;
  cancel_reason?: string | null;
  start_otp: string | null;
  end_otp: string | null;
  start_otp_verified: boolean | null;
  end_otp_verified: boolean | null;
  offer_status?: string | null;
  scheduled_for?: string | null;
  scheduled_release_at?: string | null;
  ride_type?: string | null;
  cancellation_fee_amount?: number | null;
};

type Driver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  lat?: number | null;
  lng?: number | null;
  last_seen?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  vehicle_color?: string | null;
  vehicle_registration?: string | null;
};

type TripEvent = {
  id: string;
  event_type: string;
  message: string | null;
  created_at: string;
};

type Rating = {
  id: string;
  rating: number;
  comment: string | null;
};

type Tracking = {
  liveState: string;
  driverFresh: boolean;
  freshnessSeconds: number | null;
  driverLastSeen: string | null;
  startOtpVerified: boolean;
  endOtpVerified: boolean;
  scheduledFor: string | null;
  scheduledReleaseAt: string | null;
};

declare global {
  interface Window {
    google: typeof google;
  }
}

const DEFAULT_CENTER = { lat: -25.12, lng: 29.05 };

const CANCEL_REASONS = [
  "Driver is taking too long",
  "Booked by mistake",
  "Changed my plans",
  "Found another ride",
  "Pickup location issue",
  "Other",
] as const;

function statusLabel(status: string | null | undefined) {
  switch (status) {
    case "requested":
      return "Searching for driver";
    case "offered":
      return "Trip offer sent";
    case "assigned":
      return "Driver is on the way";
    case "arrived":
      return "Driver has arrived";
    case "ongoing":
      return "Trip in progress";
    case "completed":
      return "Trip completed";
    case "cancelled":
      return "Trip cancelled";
    case "scheduled":
      return "Ride scheduled";
    default:
      return status || "Unknown";
  }
}

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayValue(value: string | null | undefined) {
  return value?.trim() || "--";
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function statusChipClass(status: string | null | undefined) {
  switch (status) {
    case "completed":
      return "moovu-chip moovu-chip-success";
    case "cancelled":
      return "moovu-chip moovu-chip-danger";
    case "ongoing":
      return "moovu-chip moovu-chip-primary";
    case "arrived":
      return "moovu-chip moovu-chip-warning";
    default:
      return "moovu-chip";
  }
}

export default function RideTrackingPage() {
  const router = useRouter();
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;

  const [trip, setTrip] = useState<RideTrip | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [events, setEvents] = useState<TripEvent[]>([]);
  const [rating, setRating] = useState<Rating | null>(null);
  const [tracking, setTracking] = useState<Tracking | null>(null);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelReason, setCancelReason] =
    useState<(typeof CANCEL_REASONS)[number]>("Driver is taking too long");
  const [mapError, setMapError] = useState<string | null>(null);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token || "";
  }

  async function loadTrip() {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      router.replace(`/customer/auth?next=/ride/${tripId}`);
      return;
    }

    const res = await fetch(`/api/customer/trip-status?tripId=${encodeURIComponent(tripId)}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load trip.");
      setLoading(false);
      return;
    }

    setTrip(json.trip ?? null);
    setDriver(json.driver ?? null);
    setEvents(json.events ?? []);
    setRating(json.rating ?? null);
    setTracking(json.tracking ?? null);
    setLoading(false);
  }

  function clearMapLayers() {
    if (pickupMarkerRef.current) pickupMarkerRef.current.setMap(null);
    if (dropoffMarkerRef.current) dropoffMarkerRef.current.setMap(null);
    if (driverMarkerRef.current) driverMarkerRef.current.setMap(null);
    if (directionsRendererRef.current) directionsRendererRef.current.setMap(null);

    pickupMarkerRef.current = null;
    dropoffMarkerRef.current = null;
    driverMarkerRef.current = null;
    directionsRendererRef.current = null;
  }

  function initMapIfNeeded() {
    if (!mapRef.current || !window.google?.maps) return false;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
        center: DEFAULT_CENTER,
        zoom: 12,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
      });
    }

    return true;
  }

  function updateMap() {
    if (!trip || !initMapIfNeeded()) return;

    const map = mapInstanceRef.current!;
    clearMapLayers();

    const bounds = new window.google.maps.LatLngBounds();
    let hasPoints = false;

    if (trip.pickup_lat != null && trip.pickup_lng != null) {
      const pos = { lat: Number(trip.pickup_lat), lng: Number(trip.pickup_lng) };
      pickupMarkerRef.current = new window.google.maps.Marker({
        map,
        position: pos,
        title: "Pickup",
        label: "P",
      });
      bounds.extend(pos);
      hasPoints = true;
    }

    if (trip.dropoff_lat != null && trip.dropoff_lng != null) {
      const pos = { lat: Number(trip.dropoff_lat), lng: Number(trip.dropoff_lng) };
      dropoffMarkerRef.current = new window.google.maps.Marker({
        map,
        position: pos,
        title: "Dropoff",
        label: "D",
      });
      bounds.extend(pos);
      hasPoints = true;
    }

    if (driver?.lat != null && driver?.lng != null) {
      const pos = { lat: Number(driver.lat), lng: Number(driver.lng) };
      driverMarkerRef.current = new window.google.maps.Marker({
        map,
        position: pos,
        title: "Driver",
        label: "R",
      });
      bounds.extend(pos);
      hasPoints = true;
    }

    if (hasPoints && !bounds.isEmpty()) {
      map.fitBounds(bounds);
      window.setTimeout(() => {
        const zoom = map.getZoom();
        if (zoom && zoom > 15) map.setZoom(15);
      }, 250);
    } else {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(11);
    }

    if (
      driver?.lat != null &&
      driver?.lng != null &&
      trip.pickup_lat != null &&
      trip.pickup_lng != null &&
      (trip.status === "assigned" || trip.status === "arrived")
    ) {
      const directionsService = new window.google.maps.DirectionsService();
      const directionsRenderer = new window.google.maps.DirectionsRenderer({
        suppressMarkers: true,
        preserveViewport: true,
      });
      directionsRenderer.setMap(map);
      directionsRendererRef.current = directionsRenderer;

      directionsService.route(
        {
          origin: { lat: Number(driver.lat), lng: Number(driver.lng) },
          destination: { lat: Number(trip.pickup_lat), lng: Number(trip.pickup_lng) },
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === "OK" && result) {
            directionsRenderer.setDirections(result);
          }
        }
      );
    }

    if (
      driver?.lat != null &&
      driver?.lng != null &&
      trip.dropoff_lat != null &&
      trip.dropoff_lng != null &&
      trip.status === "ongoing"
    ) {
      const directionsService = new window.google.maps.DirectionsService();
      const directionsRenderer = new window.google.maps.DirectionsRenderer({
        suppressMarkers: true,
        preserveViewport: true,
      });
      directionsRenderer.setMap(map);
      directionsRendererRef.current = directionsRenderer;

      directionsService.route(
        {
          origin: { lat: Number(driver.lat), lng: Number(driver.lng) },
          destination: { lat: Number(trip.dropoff_lat), lng: Number(trip.dropoff_lng) },
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === "OK" && result) {
            directionsRenderer.setDirections(result);
          }
        }
      );
    }
  }

  useEffect(() => {
    const firstLoadTimer = window.setTimeout(() => {
      void loadTrip();
    }, 0);
    const pollTimer = window.setInterval(() => {
      void loadTrip();
    }, 4000);

    return () => {
      window.clearTimeout(firstLoadTimer);
      window.clearInterval(pollTimer);
    };
  }, [tripId]);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
    if (!apiKey) {
      const timer = window.setTimeout(() => {
        setMapError("Google Maps API key is missing.");
      }, 0);

      return () => window.clearTimeout(timer);
    }

    function ready() {
      updateMap();
    }

    if (window.google?.maps) {
      ready();
      return;
    }

    const existingScript = document.getElementById(
      "google-maps-script-rider-secure"
    ) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener("load", ready);
      return () => existingScript.removeEventListener("load", ready);
    }

    const script = document.createElement("script");
    script.id = "google-maps-script-rider-secure";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = ready;
    script.onerror = () => setMapError("Failed to load Google Maps.");
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    if (!window.google?.maps) return;
    updateMap();
  }, [trip, driver]);

  async function cancelTrip() {
    if (!trip) return;

    setCancelBusy(true);
    setMsg(null);

    try {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        router.replace(`/customer/auth?next=/ride/${tripId}`);
        return;
      }

      const res = await fetch("/api/customer/cancel-trip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          tripId: trip.id,
          reason: cancelReason,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setMsg(json?.error || "Failed to cancel trip.");
        setCancelBusy(false);
        return;
      }

      setMsg(json.message || "Trip cancelled successfully.");
      await loadTrip();
    } catch (error: unknown) {
      setMsg(error instanceof Error ? error.message : "Failed to cancel trip.");
    }

    setCancelBusy(false);
  }

  const canCancel = useMemo(() => {
    if (!trip) return false;
    return trip.status !== "completed" && trip.status !== "cancelled" && trip.status !== "ongoing";
  }, [trip]);

  const canShare = useMemo(() => {
    if (!trip) return false;
    return trip.status === "ongoing" && !!trip.start_otp_verified;
  }, [trip]);

  const carText = useMemo(() => {
    if (!driver) return "--";
    return [driver.vehicle_make, driver.vehicle_model, driver.vehicle_color]
      .filter(Boolean)
      .join(" - ") || "--";
  }, [driver]);

  const statusCta = useMemo(() => {
    switch (trip?.status) {
      case "requested":
      case "offered":
        return "We are finding a nearby MOOVU driver.";
      case "assigned":
        return "Your driver is on the way to pickup.";
      case "arrived":
        return "Your driver has arrived. Share the start OTP when ready.";
      case "ongoing":
        return "Trip in progress. Share trip details with someone you trust if needed.";
      case "completed":
        return "Trip complete. Your receipt is ready.";
      case "cancelled":
        return "This trip was cancelled.";
      default:
        return "Track your MOOVU trip status here.";
    }
  }, [trip?.status]);

  const topTimeline = useMemo(() => {
    const status = trip?.status;
    return [
      {
        label: "Requested",
        active: !!status,
        done: ["requested", "offered", "assigned", "arrived", "ongoing", "completed"].includes(
          status || ""
        ),
      },
      {
        label: "Matched",
        active: ["offered", "assigned", "arrived", "ongoing", "completed"].includes(status || ""),
        done: ["assigned", "arrived", "ongoing", "completed"].includes(status || ""),
      },
      {
        label: "Pickup",
        active: ["assigned", "arrived", "ongoing", "completed"].includes(status || ""),
        done: ["arrived", "ongoing", "completed"].includes(status || ""),
      },
      {
        label: "On trip",
        active: ["ongoing", "completed"].includes(status || ""),
        done: ["completed"].includes(status || ""),
      },
      {
        label: "Done",
        active: ["completed"].includes(status || ""),
        done: ["completed"].includes(status || ""),
      },
    ];
  }, [trip?.status]);

  if (loading) {
    return (
      <LoadingState
        title="Loading your live trip"
        description="Preparing the map, driver details, route status, and trip controls."
      />
    );
  }

  if (!trip) {
    return (
      <main className="moovu-page moovu-shell p-6 text-black">
        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
        Trip not found.
      </main>
    );
  }

  return (
    <main className="moovu-page text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-shell">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="moovu-section-title">MOOVU Ride</div>
            <h1 className="mt-1 text-3xl font-black text-slate-950">Track your ride</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{statusCta}</p>
          </div>

          <div className={statusChipClass(trip.status)}>
            <span className="moovu-chip-dot" />
            {statusLabel(trip.status)}
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-5">
          {topTimeline.map((item) => (
            <div
              key={item.label}
              className={`rounded-2xl border px-4 py-3 text-center ${
                item.done
                  ? "border-blue-100 bg-[var(--moovu-primary-soft)] text-slate-900"
                  : item.active
                  ? "border-slate-200 bg-slate-100 text-slate-700"
                  : "border-slate-200 bg-white text-slate-400"
              }`}
            >
              <div className="text-xs uppercase tracking-wide opacity-80">Step</div>
              <div className="mt-1 text-sm font-semibold">{item.label}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <section className="relative min-h-[68vh] overflow-hidden rounded-[28px] border border-[var(--moovu-border)] bg-white shadow-sm">
            <div className="absolute left-4 top-4 z-10 rounded-full bg-white/95 px-4 py-2 text-sm font-medium text-slate-700 shadow">
              {tracking?.liveState || statusLabel(trip.status)}
            </div>

            {mapError ? (
              <div className="flex min-h-[68vh] items-center justify-center bg-slate-50 p-6 text-sm text-slate-700">
                {mapError}
              </div>
            ) : (
              <div ref={mapRef} className="min-h-[68vh] w-full bg-slate-100" />
            )}

            <div className="absolute bottom-0 left-0 right-0 z-10 rounded-t-[28px] border-t border-white/70 bg-white/95 p-4 shadow-[0_-16px_45px_rgba(15,23,42,0.14)] backdrop-blur md:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                    Current status
                  </div>
                  <div className="mt-1 text-lg font-black text-slate-950">
                    {statusLabel(trip.status)}
                  </div>
                </div>
                {trip.status === "completed" && (
                  <Link href={`/ride/${trip.id}/receipt`} className="moovu-btn moovu-btn-primary">
                    Receipt
                  </Link>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="moovu-stat-card">
                  <div className="moovu-stat-label">Fare</div>
                  <div className="moovu-stat-value">{money(trip.fare_amount)}</div>
                </div>

                <div className="moovu-stat-card">
                  <div className="moovu-stat-label">Payment</div>
                  <div className="moovu-stat-value capitalize">
                    {displayValue(trip.payment_method)}
                  </div>
                </div>

                <div className="moovu-stat-card">
                  <div className="moovu-stat-label">Requested</div>
                  <div className="mt-2 text-sm font-medium text-slate-900">
                    {displayDate(trip.created_at)}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="moovu-card p-5">
              <div className="text-sm text-slate-500">Driver</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {driver
                  ? `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || "Assigned"
                  : "Searching..."}
              </div>

              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Phone</div>
                  <div className="mt-1 text-sm font-medium text-slate-900">{displayValue(driver?.phone)}</div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Vehicle</div>
                  <div className="mt-1 text-sm font-medium text-slate-900">{carText}</div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Registration</div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    {displayValue(driver?.vehicle_registration)}
                  </div>
                </div>
              </div>

              {tracking && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">GPS fresh</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {tracking.driverFresh ? "Yes" : "No"}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Freshness</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {tracking.freshnessSeconds ?? "--"}s
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="moovu-card p-5">
              <div className="text-sm font-medium text-slate-500">Trip route</div>

              <div className="mt-4 space-y-4">
                <div className="flex gap-3">
                  <div className="mt-1 h-3 w-3 rounded-full bg-[var(--moovu-primary)]" />
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Pickup</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {displayValue(trip.pickup_address)}
                    </div>
                  </div>
                </div>

                <div className="ml-[5px] h-8 w-0.5 bg-slate-200" />

                <div className="flex gap-3">
                  <div className="mt-1 h-3 w-3 rounded-full bg-slate-900" />
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Dropoff</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {displayValue(trip.dropoff_address)}
                    </div>
                  </div>
                </div>
              </div>

              {trip.ride_type === "scheduled" && (
                <div className="mt-4 grid gap-3">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Scheduled for</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {displayDate(trip.scheduled_for)}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Planned release</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {trip.scheduled_release_at
                        ? new Date(trip.scheduled_release_at).toLocaleString()
                        : "--"}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="moovu-card p-5">
              <div className="text-sm font-medium text-slate-500">Ride OTP</div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div
                  className={`rounded-2xl p-4 ${
                    trip.start_otp_verified
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  <div className="text-xs uppercase tracking-wide opacity-80">Start OTP</div>
                  <div className="mt-1 text-2xl font-semibold tracking-[0.25em]">
                    {trip.start_otp ?? "--"}
                  </div>
                  <div className="mt-2 text-xs">
                    {trip.start_otp_verified ? "Verified" : "Give this to driver to start trip"}
                  </div>
                </div>

                <div
                  className={`rounded-2xl p-4 ${
                    trip.end_otp_verified
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  <div className="text-xs uppercase tracking-wide opacity-80">End OTP</div>
                  <div className="mt-1 text-2xl font-semibold tracking-[0.25em]">
                    {trip.end_otp ?? "--"}
                  </div>
                  <div className="mt-2 text-xs">
                    {trip.end_otp_verified ? "Verified" : "Use this when the trip ends"}
                  </div>
                </div>
              </div>
            </section>

            <section className="moovu-card p-5">
              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/ride/${trip.id}/receipt`}
                  className="moovu-btn moovu-btn-secondary"
                >
                  View receipt
                </Link>

                {canShare && (
                  <Link
                    href={`/ride/${trip.id}/share`}
                    className="moovu-btn moovu-btn-primary"
                  >
                    Share trip
                  </Link>
                )}

                {trip.status === "completed" && !rating && (
                  <Link
                    href={`/ride/${trip.id}/rate`}
                    className="moovu-btn moovu-btn-secondary"
                  >
                    Rate driver
                  </Link>
                )}

                <Link
                  href={`/ride/${trip.id}/support`}
                  className="moovu-btn moovu-btn-secondary"
                >
                  Report issue
                </Link>
              </div>
            </section>
          </aside>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <section className="moovu-card p-5">
            <div className="text-sm font-medium text-slate-500">Trip timeline</div>

            {events.length === 0 ? (
              <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                No events yet.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {events.map((event) => (
                  <div key={event.id} className="flex gap-3 rounded-2xl bg-slate-50 p-4">
                    <div className="mt-1 h-3 w-3 rounded-full bg-[var(--moovu-primary)]" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{event.event_type}</div>
                      {event.message && (
                        <div className="mt-1 text-sm text-slate-700">{event.message}</div>
                      )}
                      <div className="mt-2 text-xs text-slate-500">
                        {new Date(event.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="moovu-card p-5">
            <div className="text-sm font-medium text-slate-500">Trip controls</div>

            {trip.status === "cancelled" ? (
              <div className="mt-4 rounded-2xl bg-red-50 p-4">
                <div className="text-sm font-semibold text-red-700">Trip cancelled</div>
                <div className="mt-2 text-sm text-red-700">
                  Reason: {trip.cancel_reason ?? "--"}
                </div>
                {Number(trip.cancellation_fee_amount ?? 0) > 0 && (
                  <div className="mt-2 text-sm font-medium text-red-700">
                    Cancellation fee: {money(trip.cancellation_fee_amount)}
                  </div>
                )}
              </div>
            ) : trip.status === "completed" ? (
              <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">
                Completed trips cannot be cancelled.
              </div>
            ) : trip.status === "ongoing" ? (
              <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">
                Once a trip has started, use the support section for any issue instead of cancelling here.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Select cancellation reason
                  </label>
                  <select
                    className="moovu-input"
                    value={cancelReason}
                    onChange={(e) =>
                      setCancelReason(e.target.value as (typeof CANCEL_REASONS)[number])
                    }
                  >
                    {CANCEL_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  disabled={!canCancel || cancelBusy}
                  onClick={cancelTrip}
                  className="moovu-btn bg-red-600 text-white disabled:opacity-60"
                >
                  {cancelBusy ? "Cancelling..." : "Cancel trip"}
                </button>
              </div>
            )}

            {rating && (
              <div className="mt-5 rounded-2xl bg-slate-100 p-4 text-slate-900">
                <div className="text-sm text-slate-500">Your rating</div>
                <div className="mt-1 text-2xl font-semibold">{rating.rating} / 5</div>
                {rating.comment && (
                  <div className="mt-2 text-sm text-slate-700">{rating.comment}</div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
