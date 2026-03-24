"use client";

import Link from "next/link";
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
  driver_lat?: number | null;
  driver_lng?: number | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  vehicle_registration?: string | null;
  created_at?: string | null;
  cancel_reason?: string | null;
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

function waLinkZA(phone: string | null | undefined, message: string) {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, "");
  if (!cleaned) return null;
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

function telLink(phone: string | null | undefined) {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  return `tel:${cleaned}`;
}

export default function RideTrackingPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;

  const [trip, setTrip] = useState<RideTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const [cancelReason, setCancelReason] =
    useState<(typeof CANCEL_REASONS)[number]>("Driver is taking too long");
  const [cancelBusy, setCancelBusy] = useState(false);

  const [etaText, setEtaText] = useState<string | null>(null);
  const [distanceText, setDistanceText] = useState<string | null>(null);

  const pollTimerRef = useRef<any>(null);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const mapContainerNodeRef = useRef<HTMLDivElement | null>(null);
  const mapInitializedRef = useRef(false);

  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);

  const directionsRendererPreAssignRef =
    useRef<google.maps.DirectionsRenderer | null>(null);
  const directionsRendererToPickupRef =
    useRef<google.maps.DirectionsRenderer | null>(null);
  const directionsRendererTripRef =
    useRef<google.maps.DirectionsRenderer | null>(null);

  async function loadTrip() {
    if (!tripId) return;

    try {
      const res = await fetch(
        `/api/public/trip-status?tripId=${encodeURIComponent(tripId)}`,
        { cache: "no-store" }
      );

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setMsg("Trip status route is not returning JSON.");
        setLoading(false);
        return;
      }

      const json = await res.json();

      if (!json?.ok) {
        setTrip(null);
        setMsg(json?.error || "Failed to load trip");
        setLoading(false);
        return;
      }

      setTrip(json.trip ?? null);
      setMsg(null);
      setLoading(false);
    } catch (e: any) {
      setTrip(null);
      setMsg(e?.message || "Failed to load trip");
      setLoading(false);
    }
  }

  function clearMapOverlays() {
    if (pickupMarkerRef.current) pickupMarkerRef.current.setMap(null);
    if (dropoffMarkerRef.current) dropoffMarkerRef.current.setMap(null);
    if (driverMarkerRef.current) driverMarkerRef.current.setMap(null);

    if (directionsRendererPreAssignRef.current) {
      directionsRendererPreAssignRef.current.setMap(null);
    }
    if (directionsRendererToPickupRef.current) {
      directionsRendererToPickupRef.current.setMap(null);
    }
    if (directionsRendererTripRef.current) {
      directionsRendererTripRef.current.setMap(null);
    }

    pickupMarkerRef.current = null;
    dropoffMarkerRef.current = null;
    driverMarkerRef.current = null;
    directionsRendererPreAssignRef.current = null;
    directionsRendererToPickupRef.current = null;
    directionsRendererTripRef.current = null;
  }

  function ensureMap() {
    if (!window.google?.maps) return false;
    if (!mapRef.current) return false;

    const currentNode = mapRef.current;
    const containerChanged =
      !!mapContainerNodeRef.current && mapContainerNodeRef.current !== currentNode;

    if (!mapInitializedRef.current || !mapInstanceRef.current || containerChanged) {
      mapInstanceRef.current = new window.google.maps.Map(currentNode, {
        center: DEFAULT_CENTER,
        zoom: 12,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
      });

      mapContainerNodeRef.current = currentNode;
      mapInitializedRef.current = true;
    }

    return true;
  }

  function drawTripOnMap() {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps || !trip) return;

    clearMapOverlays();
    setEtaText(null);
    setDistanceText(null);

    const pickupOk =
      typeof trip.pickup_lat === "number" && typeof trip.pickup_lng === "number";
    const dropoffOk =
      typeof trip.dropoff_lat === "number" && typeof trip.dropoff_lng === "number";
    const driverOk =
      typeof trip.driver_lat === "number" && typeof trip.driver_lng === "number";

    const bounds = new window.google.maps.LatLngBounds();

    if (pickupOk) {
      const pickupPos = { lat: trip.pickup_lat!, lng: trip.pickup_lng! };
      pickupMarkerRef.current = new window.google.maps.Marker({
        position: pickupPos,
        map,
        title: "Pickup",
        label: "P",
      });
      bounds.extend(pickupPos);
    }

    if (dropoffOk) {
      const dropoffPos = { lat: trip.dropoff_lat!, lng: trip.dropoff_lng! };
      dropoffMarkerRef.current = new window.google.maps.Marker({
        position: dropoffPos,
        map,
        title: "Destination",
        label: "D",
      });
      bounds.extend(dropoffPos);
    }

    if (driverOk) {
      const driverPos = { lat: trip.driver_lat!, lng: trip.driver_lng! };
      driverMarkerRef.current = new window.google.maps.Marker({
        position: driverPos,
        map,
        title: "Driver",
        label: "Y",
      });
      bounds.extend(driverPos);
    }

    const fitBoundsSafely = () => {
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds);
        window.setTimeout(() => {
          const zoom = map.getZoom();
          if (zoom && zoom > 15) map.setZoom(15);
        }, 300);
      } else {
        map.setCenter(DEFAULT_CENTER);
        map.setZoom(11);
      }
    };

    const directionsService = new window.google.maps.DirectionsService();

    const isPreAssignmentStatus =
      trip.status === "requested" ||
      trip.status === "pending" ||
      trip.status === "searching" ||
      trip.status === "unassigned";

    if (isPreAssignmentStatus && pickupOk && dropoffOk) {
      const preAssignRenderer = new window.google.maps.DirectionsRenderer({
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: {
          strokeColor: "#1d4ed8",
          strokeOpacity: 1,
          strokeWeight: 6,
        },
      });

      preAssignRenderer.setMap(map);
      directionsRendererPreAssignRef.current = preAssignRenderer;

      directionsService.route(
        {
          origin: { lat: trip.pickup_lat!, lng: trip.pickup_lng! },
          destination: { lat: trip.dropoff_lat!, lng: trip.dropoff_lng! },
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === "OK" && result) {
            preAssignRenderer.setDirections(result);

            const legs = result.routes?.[0]?.legs ?? [];
            if (legs.length) {
              const totalSeconds = legs.reduce(
                (sum, leg) => sum + (leg.duration?.value ?? 0),
                0
              );
              const totalMeters = legs.reduce(
                (sum, leg) => sum + (leg.distance?.value ?? 0),
                0
              );

              setEtaText(`${Math.max(1, Math.round(totalSeconds / 60))} min`);
              setDistanceText(
                totalMeters >= 1000
                  ? `${(totalMeters / 1000).toFixed(1)} km`
                  : `${totalMeters} m`
              );

              legs.forEach((leg) => {
                if (leg.start_location) bounds.extend(leg.start_location);
                if (leg.end_location) bounds.extend(leg.end_location);
              });
            }
          }

          fitBoundsSafely();
        }
      );

      return;
    }

    if (driverOk && pickupOk && dropoffOk) {
      const toPickupRenderer = new window.google.maps.DirectionsRenderer({
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: {
          strokeColor: "#60a5fa",
          strokeOpacity: 1,
          strokeWeight: 6,
        },
      });

      const tripRenderer = new window.google.maps.DirectionsRenderer({
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: {
          strokeColor: "#1d4ed8",
          strokeOpacity: 1,
          strokeWeight: 6,
        },
      });

      toPickupRenderer.setMap(map);
      tripRenderer.setMap(map);

      directionsRendererToPickupRef.current = toPickupRenderer;
      directionsRendererTripRef.current = tripRenderer;

      directionsService.route(
        {
          origin: { lat: trip.driver_lat!, lng: trip.driver_lng! },
          destination: { lat: trip.pickup_lat!, lng: trip.pickup_lng! },
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (resultToPickup, statusToPickup) => {
          if (statusToPickup === "OK" && resultToPickup) {
            toPickupRenderer.setDirections(resultToPickup);

            const firstLeg = resultToPickup.routes?.[0]?.legs?.[0];
            setEtaText(firstLeg?.duration?.text ?? null);
            setDistanceText(firstLeg?.distance?.text ?? null);

            resultToPickup.routes?.[0]?.legs?.forEach((leg) => {
              if (leg.start_location) bounds.extend(leg.start_location);
              if (leg.end_location) bounds.extend(leg.end_location);
            });
          }

          directionsService.route(
            {
              origin: { lat: trip.pickup_lat!, lng: trip.pickup_lng! },
              destination: { lat: trip.dropoff_lat!, lng: trip.dropoff_lng! },
              travelMode: window.google.maps.TravelMode.DRIVING,
            },
            (resultTrip, statusTrip) => {
              if (statusTrip === "OK" && resultTrip) {
                tripRenderer.setDirections(resultTrip);

                resultTrip.routes?.[0]?.legs?.forEach((leg) => {
                  if (leg.start_location) bounds.extend(leg.start_location);
                  if (leg.end_location) bounds.extend(leg.end_location);
                });
              }

              fitBoundsSafely();
            }
          );
        }
      );

      return;
    }

    fitBoundsSafely();
  }

  async function cancelTrip() {
    if (!trip) return;

    setCancelBusy(true);
    setMsg(null);

    try {
      const res = await fetch("/api/public/cancel-trip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tripId: trip.id,
          reason: cancelReason,
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setMsg("Cancel route is not returning JSON.");
        setCancelBusy(false);
        return;
      }

      const json = await res.json();

      if (!json?.ok) {
        setMsg(json?.error || "Failed to cancel trip.");
        setCancelBusy(false);
        return;
      }

      setMsg("Trip cancelled successfully.");
      setCancelBusy(false);
      await loadTrip();
    } catch (e: any) {
      setMsg(e?.message || "Failed to cancel trip.");
      setCancelBusy(false);
    }
  }

  useEffect(() => {
    loadTrip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  useEffect(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(() => {
      loadTrip();
    }, 3000);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: any = null;

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
    if (!apiKey) {
      setMapError("Google Maps API key is missing.");
      return;
    }

    function initWhenReady() {
      if (cancelled) return;

      if (!ensureMap()) {
        retryTimer = setTimeout(initWhenReady, 150);
        return;
      }

      drawTripOnMap();
    }

    if (window.google?.maps) {
      initWhenReady();
      return () => {
        cancelled = true;
        if (retryTimer) clearTimeout(retryTimer);
      };
    }

    const existingScript = document.getElementById("google-maps-script") as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener("load", initWhenReady);
      existingScript.addEventListener("error", () =>
        setMapError("Failed to load Google Maps script.")
      );
      return () => {
        cancelled = true;
        if (retryTimer) clearTimeout(retryTimer);
        existingScript.removeEventListener("load", initWhenReady);
      };
    }

    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;
    script.onload = initWhenReady;
    script.onerror = () => setMapError("Failed to load Google Maps script.");
    document.body.appendChild(script);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!trip) return;
    if (!mapInitializedRef.current) return;

    const t = setTimeout(() => {
      drawTripOnMap();
    }, 200);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    trip?.id,
    trip?.status,
    trip?.pickup_lat,
    trip?.pickup_lng,
    trip?.dropoff_lat,
    trip?.dropoff_lng,
    trip?.driver_lat,
    trip?.driver_lng,
  ]);

  const callDriverHref = telLink(trip?.driver_phone);
  const whatsappDriverHref = waLinkZA(
    trip?.driver_phone,
    `Hi ${trip?.driver_name ?? "Driver"}, I am your rider on MOOVU for trip ${trip?.id}.`
  );

  const carText = useMemo(() => {
    const parts = [
      trip?.vehicle_color ?? "",
      trip?.vehicle_make ?? "",
      trip?.vehicle_model ?? "",
    ].filter(Boolean);

    return parts.length ? parts.join(" ") : "—";
  }, [trip?.vehicle_color, trip?.vehicle_make, trip?.vehicle_model]);

  const canCancel =
    trip &&
    trip.status !== "completed" &&
    trip.status !== "cancelled";

  if (loading) {
    return (
      <main className="min-h-screen px-6 py-10 text-black">
        <div className="max-w-4xl mx-auto border rounded-[2rem] p-6 bg-white shadow-sm">
          Loading trip...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">MOOVU Ride Tracking</div>
          <h1 className="text-3xl font-semibold mt-1">Track Your Ride</h1>
          <p className="text-gray-700 mt-2">
            Follow your trip, driver details, car details and live progress.
          </p>
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
          <div className="border rounded-[2rem] p-6 bg-white shadow-sm">
            Trip not found.
          </div>
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
                  <div className="text-sm text-gray-600">Requested</div>
                  <div className="font-semibold mt-1 text-black">
                    {trip.created_at ? new Date(trip.created_at).toLocaleString() : "—"}
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
                    {trip.driver_name ?? (trip.driver_id ? "Assigned" : "Searching...")}
                  </div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Phone</div>
                  <div className="font-semibold mt-1 text-black">{trip.driver_phone ?? "—"}</div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Car</div>
                  <div className="font-semibold mt-1 text-black">{carText}</div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">Registration</div>
                  <div className="font-semibold mt-1 text-black">
                    {trip.vehicle_registration ?? "—"}
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">
                    {trip.driver_id ? "Driver ETA to Pickup" : "Estimated Trip Time"}
                  </div>
                  <div className="font-semibold mt-1 text-black">{etaText ?? "—"}</div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm text-gray-600">
                    {trip.driver_id ? "Driver Distance to Pickup" : "Trip Distance"}
                  </div>
                  <div className="font-semibold mt-1 text-black">{distanceText ?? "—"}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {callDriverHref ? (
                  <a
                    href={callDriverHref}
                    className="rounded-xl px-4 py-2 text-white"
                    style={{ background: "var(--moovu-primary)" }}
                  >
                    Call Driver
                  </a>
                ) : (
                  <button
                    disabled
                    className="rounded-xl px-4 py-2 text-white opacity-50"
                    style={{ background: "var(--moovu-primary)" }}
                  >
                    Call Driver
                  </button>
                )}

                {whatsappDriverHref ? (
                  <a
                    href={whatsappDriverHref}
                    target="_blank"
                    rel="noreferrer"
                    className="border rounded-xl px-4 py-2 bg-white text-black"
                  >
                    WhatsApp Driver
                  </a>
                ) : (
                  <button
                    disabled
                    className="border rounded-xl px-4 py-2 bg-white text-black opacity-50"
                  >
                    WhatsApp Driver
                  </button>
                )}

                <Link
                  href={`/ride/${trip.id}/receipt`}
                  className="border rounded-xl px-4 py-2 bg-white text-black"
                >
                  View Receipt
                </Link>
              </div>
            </section>

            <section className="border rounded-[2rem] p-5 bg-white shadow-sm space-y-3">
              <h2 className="text-xl font-semibold text-black">Live Tracking Map</h2>

              {mapError ? (
                <div
                  className="border rounded-2xl p-4 text-sm text-black"
                  style={{ background: "var(--moovu-primary-soft)" }}
                >
                  {mapError}
                </div>
              ) : (
                <div
                  ref={mapRef}
                  className="w-full h-[55vh] rounded-[1.5rem] border bg-gray-100"
                />
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
                </div>
              ) : trip.status === "completed" ? (
                <div className="border rounded-2xl p-4 bg-white text-black">
                  Completed trips cannot be cancelled.
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
          </>
        )}
      </div>
    </main>
  );
}