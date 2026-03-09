"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

type Trip = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  fare_amount: number | null;
  payment_method: string | null;
  status: string;
  offer_status: string | null;
  offer_expires_at: string | null;
  cancel_reason: string | null;
  created_at: string;
};

type Driver = {
  id: string;
  name: string;
  phone: string | null;
  online: boolean | null;
  busy: boolean | null;
  status: string | null;
  lat: number | null;
  lng: number | null;
  last_seen: string | null;
  vehicle_registration: string | null;
  vehicle_color: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
};

declare global {
  interface Window {
    google: typeof google;
  }
}

export default function RiderTrackingPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [etaText, setEtaText] = useState<string | null>(null);
  const [distanceText, setDistanceText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  async function loadStatus() {
    const res = await fetch(`/api/public/ride-status?tripId=${encodeURIComponent(tripId)}`);
    const json = await res.json();

    if (!json.ok) {
      setMsg(json.error || "Failed to load trip");
      setTrip(null);
      setDriver(null);
      return;
    }

    setMsg(null);
    setTrip(json.trip ?? null);
    setDriver(json.driver ?? null);
  }

  function clearMapThings() {
    if (pickupMarkerRef.current) pickupMarkerRef.current.setMap(null);
    if (dropoffMarkerRef.current) dropoffMarkerRef.current.setMap(null);
    if (driverMarkerRef.current) driverMarkerRef.current.setMap(null);

    pickupMarkerRef.current = null;
    dropoffMarkerRef.current = null;
    driverMarkerRef.current = null;

    if (directionsRendererRef.current) {
      directionsRendererRef.current.setMap(null);
      directionsRendererRef.current = null;
    }
  }

  function drawRouteAndEta() {
    const map = mapInstanceRef.current;
    if (!map || !window.google || !trip || !driver) {
      setEtaText(null);
      setDistanceText(null);
      return;
    }

    const hasDriver = typeof driver.lat === "number" && typeof driver.lng === "number";
    const hasPickup = typeof trip.pickup_lat === "number" && typeof trip.pickup_lng === "number";

    if (!hasDriver || !hasPickup) {
      setEtaText(null);
      setDistanceText(null);
      return;
    }

    const directionsService = new window.google.maps.DirectionsService();
    const directionsRenderer = new window.google.maps.DirectionsRenderer({
      suppressMarkers: true,
      preserveViewport: true,
    });

    directionsRenderer.setMap(map);
    directionsRendererRef.current = directionsRenderer;

    directionsService.route(
      {
        origin: { lat: driver.lat!, lng: driver.lng! },
        destination: { lat: trip.pickup_lat!, lng: trip.pickup_lng! },
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (
        result: google.maps.DirectionsResult | null,
        status: google.maps.DirectionsStatus
      ) => {
        if (status !== "OK" || !result) {
          setEtaText("ETA unavailable");
          setDistanceText(null);
          return;
        }

        directionsRenderer.setDirections(result);

        const leg = result.routes?.[0]?.legs?.[0];
        setEtaText(leg?.duration?.text ?? null);
        setDistanceText(leg?.distance?.text ?? null);
      }
    );
  }

  function renderMap() {
    const map = mapInstanceRef.current;
    if (!map || !window.google || !trip) return;

    clearMapThings();

    const bounds = new window.google.maps.LatLngBounds();

    if (typeof trip.pickup_lat === "number" && typeof trip.pickup_lng === "number") {
      pickupMarkerRef.current = new window.google.maps.Marker({
        map,
        position: { lat: trip.pickup_lat, lng: trip.pickup_lng },
        title: "Pickup",
        label: { text: "P", color: "white", fontWeight: "bold" },
      });

      bounds.extend({ lat: trip.pickup_lat, lng: trip.pickup_lng });
    }

    if (typeof trip.dropoff_lat === "number" && typeof trip.dropoff_lng === "number") {
      dropoffMarkerRef.current = new window.google.maps.Marker({
        map,
        position: { lat: trip.dropoff_lat, lng: trip.dropoff_lng },
        title: "Dropoff",
        label: { text: "D", color: "white", fontWeight: "bold" },
      });

      bounds.extend({ lat: trip.dropoff_lat, lng: trip.dropoff_lng });
    }

    if (driver && typeof driver.lat === "number" && typeof driver.lng === "number") {
      driverMarkerRef.current = new window.google.maps.Marker({
        map,
        position: { lat: driver.lat, lng: driver.lng },
        title: driver.name,
        label: { text: "🚗", color: "white" },
      });

      bounds.extend({ lat: driver.lat, lng: driver.lng });
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds);
      window.setTimeout(() => {
        if (map.getZoom() && map.getZoom()! > 15) map.setZoom(15);
      }, 300);
    }

    drawRouteAndEta();
  }

  async function cancelRide() {
    if (!trip) return;

    const riderPhone = prompt("Enter the same phone number used to book this ride:");
    if (!riderPhone?.trim()) return;

    const reason = prompt("Cancel reason?")?.trim() || "Cancelled by rider";

    setBusy(true);
    const res = await fetch("/api/public/cancel-ride", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tripId: trip.id,
        riderPhone: riderPhone.trim(),
        reason,
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Failed to cancel ride");
      return;
    }

    setMsg("Ride cancelled ✅");
    await loadStatus();
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      await loadStatus();
      if (cancelled) return;

      if (!window.google) {
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
          process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""
        )}`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
          if (cancelled || !mapRef.current) return;

          mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
            center: { lat: -25.12, lng: 29.05 },
            zoom: 12,
            mapTypeControl: true,
            streetViewControl: false,
            fullscreenControl: true,
          });

          setLoaded(true);
        };
        document.body.appendChild(script);
      } else {
        if (!mapRef.current) return;

        mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
          center: { lat: -25.12, lng: 29.05 },
          zoom: 12,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        });

        setLoaded(true);
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, [tripId]);

  useEffect(() => {
    if (!loaded) return;
    renderMap();
  }, [loaded, trip, driver]);

  useEffect(() => {
    const t = setInterval(() => {
      loadStatus();
    }, 5000);

    return () => clearInterval(t);
  }, [tripId]);

  const riderStatusText = useMemo(() => {
    if (!trip) return "Loading trip...";
    if (trip.status === "requested") return "Searching for driver...";
    if (trip.status === "offered") return "Offering trip to nearby driver...";
    if (trip.status === "assigned") return "Driver assigned and on the way.";
    if (trip.status === "arrived") return "Driver has arrived at pickup.";
    if (trip.status === "started") return "Trip in progress.";
    if (trip.status === "completed") return "Trip completed.";
    if (trip.status === "cancelled") return `Trip cancelled${trip.cancel_reason ? `: ${trip.cancel_reason}` : ""}`;
    return trip.status;
  }, [trip]);

  const canCancel = trip && ["requested", "offered", "assigned"].includes(trip.status);

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm border bg-white mb-3">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: "var(--moovu-primary)" }}
              />
              Live ride tracking
            </div>
            <h1 className="text-3xl md:text-4xl font-semibold text-black">Track Your Ride</h1>
            <p className="text-gray-700 mt-2">Trip ID: {tripId}</p>
          </div>

          {canCancel ? (
            <button
              className="rounded-xl px-4 py-2 text-white"
              style={{ background: "var(--moovu-accent)" }}
              disabled={busy}
              onClick={cancelRide}
            >
              {busy ? "Cancelling..." : "Cancel Ride"}
            </button>
          ) : null}
        </div>

        {msg && (
          <div
            className="border rounded-2xl p-4 text-sm text-black"
            style={{ background: "var(--moovu-primary-soft)" }}
          >
            {msg}
          </div>
        )}

        {!trip ? (
          <section className="border rounded-2xl p-5 bg-white shadow-sm">
            <p className="text-gray-700">Loading trip...</p>
          </section>
        ) : (
          <>
            <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
              <h2 className="text-xl font-semibold text-black">Trip Status</h2>

              <div className="text-xl font-medium" style={{ color: "var(--moovu-primary)" }}>
                {riderStatusText}
              </div>

              {(etaText || distanceText) && trip.status !== "completed" && trip.status !== "cancelled" && driver ? (
                <div className="text-sm text-gray-700">
                  {etaText ? `ETA to pickup: ${etaText}` : ""}
                  {etaText && distanceText ? " • " : ""}
                  {distanceText ? `Distance: ${distanceText}` : ""}
                </div>
              ) : null}

              <div className="grid md:grid-cols-2 gap-4">
                <div
                  className="border rounded-2xl p-4"
                  style={{ background: "var(--moovu-primary-soft)" }}
                >
                  <div className="text-sm text-gray-600">Pickup</div>
                  <div className="font-medium mt-1 text-black">{trip.pickup_address ?? "—"}</div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Dropoff</div>
                  <div className="font-medium mt-1 text-black">{trip.dropoff_address ?? "—"}</div>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Fare</div>
                  <div className="font-semibold mt-1 text-black">R{trip.fare_amount ?? "—"}</div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Payment</div>
                  <div className="font-semibold mt-1 text-black">{trip.payment_method ?? "—"}</div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Created</div>
                  <div className="font-semibold mt-1 text-black">
                    {new Date(trip.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            </section>

            <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
              <h2 className="text-xl font-semibold text-black">Driver Details</h2>

              {!driver ? (
                <p className="text-gray-700">No driver assigned yet.</p>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  <div
                    className="border rounded-2xl p-4"
                    style={{ background: "var(--moovu-primary-soft)" }}
                  >
                    <div className="text-sm text-gray-600">Driver</div>
                    <div className="font-semibold mt-1 text-black">{driver.name}</div>
                    <div className="text-sm text-gray-700 mt-2">Phone: {driver.phone ?? "—"}</div>
                  </div>

                  <div className="border rounded-2xl p-4 bg-white">
                    <div className="text-sm text-gray-600">Vehicle</div>
                    <div className="font-semibold mt-1 text-black">
                      {driver.vehicle_color ?? "—"} {driver.vehicle_make ?? ""} {driver.vehicle_model ?? ""}
                    </div>
                    <div className="text-sm text-gray-700 mt-2">
                      Registration: {driver.vehicle_registration ?? "—"}
                    </div>
                    <div className="text-sm text-gray-700 mt-2">
                      Online: {driver.online ? "Yes" : "No"} • Last seen:{" "}
                      {driver.last_seen ? new Date(driver.last_seen).toLocaleString() : "—"}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="border rounded-[2rem] p-5 bg-white shadow-sm">
              <h2 className="text-xl font-semibold text-black mb-4">Live Map</h2>
              <div ref={mapRef} className="w-full h-[55vh] rounded-[1.5rem]" />
            </section>
          </>
        )}
      </div>
    </main>
  );
}