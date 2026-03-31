"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Trip = {
  id: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  payment_method: string | null;
  fare_amount: number | null;
  status: string;
  offer_status: string | null;
  offer_expires_at: string | null;
  start_otp: string | null;
  end_otp: string | null;
  start_otp_verified: boolean | null;
  end_otp_verified: boolean | null;
  created_at: string | null;
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

type EventRow = {
  id: string;
  event_type: string;
  message: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
};

declare global {
  interface Window {
    google: typeof google;
  }
}

const DEFAULT_CENTER = { lat: -25.12, lng: 29.05 };

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

export default function RideConfirmPage() {
  const params = useParams<{ id: string }>();
  const tripId = params.id;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  async function loadStatus() {
    const res = await fetch(`/api/public/trip-status?tripId=${encodeURIComponent(tripId)}`, {
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Could not load trip status.");
      setLoading(false);
      return;
    }

    setTrip(json.trip ?? null);
    setDriver(json.driver ?? null);
    setEvents(json.events ?? []);
    setMsg(null);
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
      const pickupPos = { lat: Number(trip.pickup_lat), lng: Number(trip.pickup_lng) };
      pickupMarkerRef.current = new window.google.maps.Marker({
        map,
        position: pickupPos,
        title: "Pickup",
        label: "P",
      });
      bounds.extend(pickupPos);
      hasPoints = true;
    }

    if (trip.dropoff_lat != null && trip.dropoff_lng != null) {
      const dropoffPos = { lat: Number(trip.dropoff_lat), lng: Number(trip.dropoff_lng) };
      dropoffMarkerRef.current = new window.google.maps.Marker({
        map,
        position: dropoffPos,
        title: "Dropoff",
        label: "D",
      });
      bounds.extend(dropoffPos);
      hasPoints = true;
    }

    if (driver?.lat != null && driver?.lng != null) {
      const driverPos = { lat: Number(driver.lat), lng: Number(driver.lng) };
      driverMarkerRef.current = new window.google.maps.Marker({
        map,
        position: driverPos,
        title: "Driver",
        label: "R",
      });
      bounds.extend(driverPos);
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
      ((trip.status === "offered" || trip.status === "assigned" || trip.status === "arrived") &&
        trip.pickup_lat != null &&
        trip.pickup_lng != null)
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
      trip.status === "ongoing" &&
      trip.dropoff_lat != null &&
      trip.dropoff_lng != null
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
    loadStatus();
    const t = setInterval(loadStatus, 4000);
    return () => clearInterval(t);
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

    const existingScript = document.getElementById("google-maps-script-rider") as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", ready);
      return () => existingScript.removeEventListener("load", ready);
    }

    const script = document.createElement("script");
    script.id = "google-maps-script-rider";
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

  const completionEvent = useMemo(() => {
    return (
      events.find(
        (e) => e.event_type === "trip_completed" || e.event_type === "trip_completed_admin"
      ) ?? null
    );
  }, [events]);

  if (loading) {
    return <main className="p-6">Loading trip status...</main>;
  }

  if (!trip) {
    return <main className="p-6">{msg || "Trip not found."}</main>;
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">MOOVU Rider</div>
          <h1 className="text-3xl font-semibold mt-1">Trip Status</h1>
          <p className="text-gray-700 mt-2">
            Status: <span className="font-medium">{trip.status}</span>
            {trip.offer_status ? ` • Offer: ${trip.offer_status}` : ""}
          </p>
        </div>

        {msg && <div className="border rounded-2xl p-4 text-sm">{msg}</div>}

        <section className="border rounded-2xl p-5 bg-white shadow-sm space-y-4">
          <h2 className="font-semibold">Live Tracking</h2>

          {mapError ? (
            <div className="border rounded-xl p-4 text-sm">{mapError}</div>
          ) : (
            <div
              ref={mapRef}
              className="w-full h-[50vh] rounded-[1.5rem] border bg-gray-100"
            />
          )}
        </section>

        <section className="border rounded-2xl p-5 bg-white shadow-sm space-y-4">
          <h2 className="font-semibold">Trip Details</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Pickup</div>
              <div className="font-medium mt-1">{trip.pickup_address ?? "—"}</div>
            </div>
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Dropoff</div>
              <div className="font-medium mt-1">{trip.dropoff_address ?? "—"}</div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Fare</div>
              <div className="font-medium mt-1">
                {trip.fare_amount != null ? `R${Number(trip.fare_amount).toFixed(2)}` : "—"}
              </div>
            </div>
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Payment</div>
              <div className="font-medium mt-1 capitalize">{trip.payment_method ?? "—"}</div>
            </div>
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Status</div>
              <div className="font-medium mt-1">{trip.status}</div>
            </div>
          </div>
        </section>

        <section className="border rounded-2xl p-5 bg-white shadow-sm space-y-4">
          <h2 className="font-semibold">Your OTPs</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Start OTP</div>
              <div className="text-2xl font-semibold mt-2">{trip.start_otp ?? "—"}</div>
              <div className="text-sm opacity-70 mt-2">
                Verified: {trip.start_otp_verified ? "Yes" : "No"}
              </div>
            </div>
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">End OTP</div>
              <div className="text-2xl font-semibold mt-2">{trip.end_otp ?? "—"}</div>
              <div className="text-sm opacity-70 mt-2">
                Verified: {trip.end_otp_verified ? "Yes" : "No"}
              </div>
            </div>
          </div>
        </section>

        <section className="border rounded-2xl p-5 bg-white shadow-sm space-y-4">
          <h2 className="font-semibold">Driver & Vehicle</h2>

          {!driver ? (
            <div className="opacity-70">A driver has not been assigned yet.</div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border rounded-xl p-4">
                <div className="text-sm opacity-70">Driver</div>
                <div className="font-medium mt-1">
                  {driver.first_name ?? "—"} {driver.last_name ?? ""}
                </div>
                <div className="text-sm opacity-70 mt-2">{driver.phone ?? "—"}</div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-sm opacity-70">Vehicle</div>
                <div className="font-medium mt-1">
                  {[driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(" ") || "—"}
                </div>
                <div className="text-sm opacity-70 mt-2">
                  {[driver.vehicle_year, driver.vehicle_color, driver.vehicle_registration]
                    .filter(Boolean)
                    .join(" • ") || "—"}
                </div>
              </div>
            </div>
          )}
        </section>

        {trip.status === "completed" && (
          <section className="border rounded-2xl p-5 bg-white shadow-sm space-y-4">
            <h2 className="font-semibold">Trip Receipt</h2>

            <div className="grid gap-3 md:grid-cols-2">
              <Link
                href={`/ride/${trip.id}/reciept`}
                className="border rounded-xl px-4 py-3 text-center"
              >
                View Receipt
              </Link>

              <button
                className="border rounded-xl px-4 py-3"
                onClick={() => window.open(`/ride/${trip.id}/reciept`, "_blank")}
              >
                Open Printable Receipt
              </button>
            </div>

            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Completed</div>
              <div className="font-medium mt-1">
                {completionEvent
                  ? new Date(completionEvent.created_at).toLocaleString()
                  : "Completed"}
              </div>
            </div>
          </section>
        )}

        <section className="border rounded-2xl p-5 bg-white shadow-sm space-y-3">
          <h2 className="font-semibold">Trip Timeline</h2>

          {events.length === 0 ? (
            <div className="opacity-70">No events yet.</div>
          ) : (
            events.map((e) => (
              <div key={e.id} className="border rounded-xl p-4">
                <div className="font-medium">{e.event_type}</div>
                {e.message && <div className="text-sm opacity-80 mt-2">{e.message}</div>}
                <div className="text-xs opacity-60 mt-2">
                  {new Date(e.created_at).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  );
}