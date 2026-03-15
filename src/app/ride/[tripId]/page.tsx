"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

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
  driver_name?: string | null;
  driver_phone?: string | null;
  driver_vehicle_make?: string | null;
  driver_vehicle_model?: string | null;
  driver_vehicle_color?: string | null;
  driver_vehicle_registration?: string | null;
  driver_lat?: number | null;
  driver_lng?: number | null;
};

declare global {
  interface Window {
    google: typeof google;
  }
}

export default function RiderTrackingPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;

  const [trip, setTrip] = useState<RideTrip | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);

  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);

  const tripRouteRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const approachRouteRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  async function loadTrip() {
    try {
      const res = await fetch(`/api/public/trip-status?tripId=${encodeURIComponent(tripId)}`, {
        cache: "no-store",
      });

      const json = await res.json();

      if (!json.ok) {
        setInfo(json.error || "Failed to load trip");
        setTrip(null);
        setLoading(false);
        return;
      }

      setInfo(null);
      setTrip(json.trip ?? null);
      setLoading(false);
    } catch (e: any) {
      setInfo(e?.message ?? "Failed to load trip");
      setTrip(null);
      setLoading(false);
    }
  }

  function clearMarkers() {
    if (pickupMarkerRef.current) pickupMarkerRef.current.setMap(null);
    if (dropoffMarkerRef.current) dropoffMarkerRef.current.setMap(null);
    if (driverMarkerRef.current) driverMarkerRef.current.setMap(null);

    pickupMarkerRef.current = null;
    dropoffMarkerRef.current = null;
    driverMarkerRef.current = null;
  }

  function clearRouteRenderers() {
    if (tripRouteRendererRef.current) {
      tripRouteRendererRef.current.setMap(null);
      tripRouteRendererRef.current = null;
    }

    if (approachRouteRendererRef.current) {
      approachRouteRendererRef.current.setMap(null);
      approachRouteRendererRef.current = null;
    }
  }

  function renderTripRoutes({
    map,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    driverLat,
    driverLng,
    tripStatus,
  }: {
    map: google.maps.Map;
    pickupLat: number | null | undefined;
    pickupLng: number | null | undefined;
    dropoffLat: number | null | undefined;
    dropoffLng: number | null | undefined;
    driverLat: number | null | undefined;
    driverLng: number | null | undefined;
    tripStatus: string | null | undefined;
  }) {
    if (!window.google?.maps) return;

    clearRouteRenderers();

    const directionsService = new window.google.maps.DirectionsService();

    const hasPickupToDropoff =
      typeof pickupLat === "number" &&
      typeof pickupLng === "number" &&
      typeof dropoffLat === "number" &&
      typeof dropoffLng === "number";

    const hasDriverToPickup =
      typeof driverLat === "number" &&
      typeof driverLng === "number" &&
      typeof pickupLat === "number" &&
      typeof pickupLng === "number";

    if (hasPickupToDropoff) {
      const tripRenderer = new window.google.maps.DirectionsRenderer({
        suppressMarkers: false,
        preserveViewport: true,
        polylineOptions: {
          strokeColor: "#2563eb",
          strokeOpacity: 0.95,
          strokeWeight: 5,
        },
      });

      tripRenderer.setMap(map);
      tripRouteRendererRef.current = tripRenderer;

      directionsService.route(
        {
          origin: { lat: pickupLat!, lng: pickupLng! },
          destination: { lat: dropoffLat!, lng: dropoffLng! },
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === "OK" && result) {
            tripRenderer.setDirections(result);
          }
        }
      );
    }

    const showApproachLine =
      tripStatus === "assigned" ||
      tripStatus === "offered" ||
      tripStatus === "arrived";

    if (showApproachLine && hasDriverToPickup) {
      const approachRenderer = new window.google.maps.DirectionsRenderer({
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: {
          strokeColor: "#60a5fa",
          strokeOpacity: 0.95,
          strokeWeight: 5,
        },
      });

      approachRenderer.setMap(map);
      approachRouteRendererRef.current = approachRenderer;

      directionsService.route(
        {
          origin: { lat: driverLat!, lng: driverLng! },
          destination: { lat: pickupLat!, lng: pickupLng! },
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === "OK" && result) {
            approachRenderer.setDirections(result);
          }
        }
      );
    }
  }

  function renderMap() {
    const map = mapInstanceRef.current;
    if (!map || !trip || !window.google?.maps) return;

    clearMarkers();

    const bounds = new window.google.maps.LatLngBounds();
    let hasAnyPoint = false;

    if (typeof trip.pickup_lat === "number" && typeof trip.pickup_lng === "number") {
      pickupMarkerRef.current = new window.google.maps.Marker({
        map,
        position: { lat: trip.pickup_lat, lng: trip.pickup_lng },
        title: "Pickup",
        label: { text: "P", color: "white", fontWeight: "bold" },
      });
      bounds.extend({ lat: trip.pickup_lat, lng: trip.pickup_lng });
      hasAnyPoint = true;
    }

    if (typeof trip.dropoff_lat === "number" && typeof trip.dropoff_lng === "number") {
      dropoffMarkerRef.current = new window.google.maps.Marker({
        map,
        position: { lat: trip.dropoff_lat, lng: trip.dropoff_lng },
        title: "Dropoff",
        label: { text: "D", color: "white", fontWeight: "bold" },
      });
      bounds.extend({ lat: trip.dropoff_lat, lng: trip.dropoff_lng });
      hasAnyPoint = true;
    }

    if (typeof trip.driver_lat === "number" && typeof trip.driver_lng === "number") {
      driverMarkerRef.current = new window.google.maps.Marker({
        map,
        position: { lat: trip.driver_lat, lng: trip.driver_lng },
        title: "Driver",
        label: { text: "Y", color: "white", fontWeight: "bold" },
      });
      bounds.extend({ lat: trip.driver_lat, lng: trip.driver_lng });
      hasAnyPoint = true;
    }

    if (hasAnyPoint && !bounds.isEmpty()) {
      map.fitBounds(bounds);
      window.setTimeout(() => {
        if (map.getZoom() && map.getZoom()! > 15) map.setZoom(15);
      }, 300);
    } else {
      map.setCenter({ lat: -25.12, lng: 29.05 });
      map.setZoom(11);
    }

    renderTripRoutes({
      map,
      pickupLat: trip.pickup_lat,
      pickupLng: trip.pickup_lng,
      dropoffLat: trip.dropoff_lat,
      dropoffLng: trip.dropoff_lng,
      driverLat: trip.driver_lat,
      driverLng: trip.driver_lng,
      tripStatus: trip.status,
    });
  }

  useEffect(() => {
    if (!tripId) return;

    setLoading(true);
    loadTrip();

    const t = setInterval(loadTrip, 5000);
    return () => clearInterval(t);
  }, [tripId]);

  useEffect(() => {
    let cancelled = false;

    function initMap() {
      if (!mapRef.current || !window.google?.maps) return;

      mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
        center: { lat: -25.12, lng: 29.05 },
        zoom: 11,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
      });

      if (!cancelled) {
        setMapReady(true);
        setMapError(null);
      }
    }

    if (window.google?.maps) {
      initMap();
      return;
    }

    const existingScript = document.getElementById("google-maps-script") as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener("load", initMap);
      return () => {
        cancelled = true;
        existingScript.removeEventListener("load", initMap);
      };
    }

    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
    if (!key) {
      setMapError("Google Maps API key is missing.");
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`;
    script.async = true;
    script.defer = true;
    script.onload = initMap;
    script.onerror = () => {
      setMapError("Failed to load Google Maps.");
    };
    document.body.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !trip) return;
    renderMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, trip]);

  const vehicleLabel = useMemo(() => {
    if (!trip) return "—";
    const parts = [
      trip.driver_vehicle_color,
      trip.driver_vehicle_make,
      trip.driver_vehicle_model,
    ].filter(Boolean);
    return parts.length ? parts.join(" ") : "—";
  }, [trip]);

  const hasMapCoordinates = useMemo(() => {
    if (!trip) return false;
    return (
      (typeof trip.pickup_lat === "number" && typeof trip.pickup_lng === "number") ||
      (typeof trip.dropoff_lat === "number" && typeof trip.dropoff_lng === "number") ||
      (typeof trip.driver_lat === "number" && typeof trip.driver_lng === "number")
    );
  }, [trip]);

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">MOOVU Ride Tracking</div>
          <h1 className="text-3xl font-semibold mt-1">Track Your Ride</h1>
          <p className="text-gray-700 mt-2">
            Follow your driver and route progress live.
          </p>
        </div>

        {info && (
          <div
            className="border rounded-2xl p-4 text-sm text-black"
            style={{ background: "var(--moovu-primary-soft)" }}
          >
            {info}
          </div>
        )}

        {loading ? (
          <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
            <p className="text-gray-700">Loading trip...</p>
          </section>
        ) : !trip ? (
          <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
            <p className="text-gray-700">Trip could not be loaded.</p>
          </section>
        ) : (
          <>
            <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
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

              <div className="grid md:grid-cols-4 gap-4">
                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Status</div>
                  <div className="font-semibold mt-1 text-black">{trip.status}</div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Fare</div>
                  <div className="font-semibold mt-1 text-black">R{trip.fare_amount ?? "—"}</div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Payment</div>
                  <div className="font-semibold mt-1 text-black">{trip.payment_method ?? "—"}</div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Trip ID</div>
                  <div className="font-semibold mt-1 text-black break-all">{trip.id}</div>
                </div>
              </div>
            </section>

            <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
              <h2 className="text-xl font-semibold text-black">Driver Details</h2>

              <div className="grid md:grid-cols-4 gap-4">
                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Driver</div>
                  <div className="font-semibold mt-1 text-black">{trip.driver_name ?? "Waiting for driver"}</div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Phone</div>
                  <div className="font-semibold mt-1 text-black">{trip.driver_phone ?? "—"}</div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Vehicle</div>
                  <div className="font-semibold mt-1 text-black">{vehicleLabel}</div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Registration</div>
                  <div className="font-semibold mt-1 text-black">{trip.driver_vehicle_registration ?? "—"}</div>
                </div>
              </div>
            </section>

            <section className="border rounded-[2rem] p-5 bg-white shadow-sm">
              <h2 className="text-xl font-semibold text-black mb-4">Live Map</h2>

              {mapError ? (
                <div className="border rounded-2xl p-4 text-sm">{mapError}</div>
              ) : !hasMapCoordinates ? (
                <div className="border rounded-2xl p-4 text-sm">
                  Trip coordinates are not available yet, so the map cannot be drawn.
                </div>
              ) : (
                <div ref={mapRef} className="w-full h-[60vh] rounded-[1.5rem]" />
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}