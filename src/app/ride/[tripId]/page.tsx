"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
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
  const [cancelReason, setCancelReason] =
    useState<(typeof CANCEL_REASONS)[number]>("Driver is taking too long");
  const [cancelBusy, setCancelBusy] = useState(false);
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
    loadTrip();
    const timer = setInterval(loadTrip, 4000);
    return () => clearInterval(timer);
  }, [tripId]);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
    if (!apiKey) {
      setMapError("Google Maps API key is missing.");
      return;
    }

    function ready() {
      updateMap();
    }

    if (window.google?.maps) {
      ready();
      return;
    }

    const existingScript = document.getElementById("google-maps-script-rider-secure") as HTMLScriptElement | null;
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
    } catch (e: any) {
      setMsg(e?.message || "Failed to cancel trip.");
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
    if (!driver) return "—";
    return [driver.vehicle_make, driver.vehicle_model, driver.vehicle_color]
      .filter(Boolean)
      .join(" • ") || "—";
  }, [driver]);

  if (loading) {
    return <main className="p-6 text-black">Loading trip...</main>;
  }

  if (!trip) {
    return (
      <main className="p-6 text-black">
        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
        Trip not found.
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">MOOVU Ride Tracking</div>
          <h1 className="text-3xl font-semibold mt-1">Track Your Ride</h1>
          <p className="text-gray-700 mt-2">
            Your trip is protected under your customer account.
          </p>
        </div>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <div className="border rounded-2xl p-4 bg-white">
            <div className="text-sm text-gray-600">Live Trip Status</div>
            <div className="text-xl font-semibold mt-1 text-black">
              {statusLabel(trip.status)}
            </div>
            <div className="text-sm text-gray-700 mt-2">
              Requested: {trip.created_at ? new Date(trip.created_at).toLocaleString() : "—"}
            </div>
          </div>

          {tracking && (
            <div className="grid md:grid-cols-4 gap-4">
              <div className="border rounded-2xl p-4 bg-white">
                <div className="text-sm text-gray-600">Tracking State</div>
                <div className="font-semibold mt-1">{tracking.liveState}</div>
              </div>

              <div className="border rounded-2xl p-4 bg-white">
                <div className="text-sm text-gray-600">Driver GPS Fresh</div>
                <div className="font-semibold mt-1">{tracking.driverFresh ? "Yes" : "No"}</div>
              </div>

              <div className="border rounded-2xl p-4 bg-white">
                <div className="text-sm text-gray-600">Driver Last Seen</div>
                <div className="font-semibold mt-1">
                  {tracking.driverLastSeen
                    ? new Date(tracking.driverLastSeen).toLocaleString()
                    : "—"}
                </div>
              </div>

              <div className="border rounded-2xl p-4 bg-white">
                <div className="text-sm text-gray-600">Freshness Seconds</div>
                <div className="font-semibold mt-1">
                  {tracking.freshnessSeconds ?? "—"}
                </div>
              </div>
            </div>
          )}

          {trip.ride_type === "scheduled" && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border rounded-2xl p-4 bg-white">
                <div className="text-sm text-gray-600">Scheduled For</div>
                <div className="font-semibold mt-1">
                  {trip.scheduled_for ? new Date(trip.scheduled_for).toLocaleString() : "—"}
                </div>
              </div>

              <div className="border rounded-2xl p-4 bg-white">
                <div className="text-sm text-gray-600">Planned Release</div>
                <div className="font-semibold mt-1">
                  {trip.scheduled_release_at ? new Date(trip.scheduled_release_at).toLocaleString() : "—"}
                </div>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-2xl p-4" style={{ background: "var(--moovu-primary-soft)" }}>
              <div className="text-sm text-gray-600">Pickup</div>
              <div className="font-medium mt-1 text-black">{trip.pickup_address ?? "—"}</div>
            </div>

            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">Dropoff</div>
              <div className="font-medium mt-1 text-black">{trip.dropoff_address ?? "—"}</div>
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-4">
            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">Fare</div>
              <div className="font-semibold mt-1 text-black">{money(trip.fare_amount)}</div>
            </div>

            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">Payment</div>
              <div className="font-semibold mt-1 text-black">{trip.payment_method ?? "—"}</div>
            </div>

            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">Start OTP</div>
              <div className="font-semibold mt-1 text-black">
                {trip.start_otp ?? "—"} {trip.start_otp_verified ? "✅" : ""}
              </div>
            </div>

            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">End OTP</div>
              <div className="font-semibold mt-1 text-black">
                {trip.end_otp ?? "—"} {trip.end_otp_verified ? "✅" : ""}
              </div>
            </div>
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold text-black">Driver & Car Details</h2>

          <div className="grid md:grid-cols-4 gap-4">
            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">Driver</div>
              <div className="font-semibold mt-1 text-black">
                {driver ? `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || "Assigned" : "Searching..."}
              </div>
            </div>

            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">Phone</div>
              <div className="font-semibold mt-1 text-black">{driver?.phone ?? "—"}</div>
            </div>

            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">Car</div>
              <div className="font-semibold mt-1 text-black">{carText}</div>
            </div>

            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">Registration</div>
              <div className="font-semibold mt-1 text-black">
                {driver?.vehicle_registration ?? "—"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/ride/${trip.id}/receipt`}
              className="border rounded-xl px-4 py-2 bg-white text-black"
            >
              View Receipt
            </Link>

            {canShare && (
              <Link
                href={`/ride/${trip.id}/share`}
                className="rounded-xl px-4 py-2 text-white"
                style={{ background: "var(--moovu-primary)" }}
              >
                Share Trip
              </Link>
            )}

            {trip.status === "completed" && !rating && (
              <Link
                href={`/ride/${trip.id}/rate`}
                className="border rounded-xl px-4 py-2 bg-white text-black"
              >
                Rate Driver
              </Link>
            )}

            <Link
              href={`/ride/${trip.id}/support`}
              className="border rounded-xl px-4 py-2 bg-white text-black"
            >
              Report Issue
            </Link>
          </div>
        </section>

        <section className="border rounded-[2rem] p-5 bg-white shadow-sm space-y-3">
          <h2 className="text-xl font-semibold text-black">Live Tracking Map</h2>

          {mapError ? (
            <div className="border rounded-2xl p-4 text-sm text-black">
              {mapError}
            </div>
          ) : (
            <div
              ref={mapRef}
              className="w-full h-[55vh] rounded-[1.5rem] border bg-gray-100"
            />
          )}
        </section>

        {rating && (
          <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
            <h2 className="text-xl font-semibold text-black">Your Rating</h2>
            <div className="mt-3 text-lg">{rating.rating} / 5</div>
            {rating.comment && <div className="mt-2 text-gray-700">{rating.comment}</div>}
          </section>
        )}

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold text-black">Trip Timeline</h2>

          {events.length === 0 ? (
            <div className="text-gray-600">No events yet.</div>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <div key={event.id} className="border rounded-xl p-4">
                  <div className="font-medium">{event.event_type}</div>
                  {event.message && <div className="text-sm text-gray-700 mt-1">{event.message}</div>}
                  <div className="text-xs text-gray-500 mt-2">
                    {new Date(event.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold text-black">Cancel Trip</h2>

          {trip.status === "cancelled" ? (
            <div className="border rounded-2xl p-4 bg-white">
              <div className="text-sm text-gray-600">Trip cancelled</div>
              <div className="font-medium mt-1 text-black">
                Reason: {trip.cancel_reason ?? "—"}
              </div>
              {Number(trip.cancellation_fee_amount ?? 0) > 0 && (
                <div className="font-medium mt-2 text-black">
                  Cancellation fee: {money(trip.cancellation_fee_amount)}
                </div>
              )}
            </div>
          ) : trip.status === "completed" ? (
            <div className="border rounded-2xl p-4 bg-white text-black">
              Completed trips cannot be cancelled.
            </div>
          ) : trip.status === "ongoing" ? (
            <div className="border rounded-2xl p-4 bg-white text-black">
              Once a trip has started, use the support section for any issue instead of cancelling here.
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm text-gray-600 mb-2">
                  Select a reason
                </label>
                <select
                  className="w-full border rounded-xl p-3 bg-white text-black"
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
                className="rounded-xl px-4 py-2 text-white"
                style={{ background: "#dc2626" }}
              >
                {cancelBusy ? "Cancelling..." : "Cancel Trip"}
              </button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}