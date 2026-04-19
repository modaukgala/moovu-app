"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type CustomerMe = {
  ok: boolean;
  customer?: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
  };
  error?: string;
};

type Prediction = {
  description: string;
  place_id: string;
};

const DEFAULT_CENTER = { lat: -26.188, lng: 28.3206 };

function wholeRand(value: number | null | undefined) {
  return value == null ? null : Math.round(Number(value));
}

function money(value: number | null | undefined) {
  return value == null ? "—" : `R${Math.round(Number(value))}`;
}

export default function RiderBookingPage() {
  const router = useRouter();

  const [customer, setCustomer] = useState<CustomerMe["customer"] | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");

  const [pickupPlaceId, setPickupPlaceId] = useState("");
  const [dropoffPlaceId, setDropoffPlaceId] = useState("");

  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);
  const [dropoffLat, setDropoffLat] = useState<number | null>(null);
  const [dropoffLng, setDropoffLng] = useState<number | null>(null);

  const [pickupPredictions, setPickupPredictions] = useState<Prediction[]>([]);
  const [dropoffPredictions, setDropoffPredictions] = useState<Prediction[]>([]);

  const [pickupLoading, setPickupLoading] = useState(false);
  const [dropoffLoading, setDropoffLoading] = useState(false);

  const [showPickupDropdown, setShowPickupDropdown] = useState(false);
  const [showDropoffDropdown, setShowDropoffDropdown] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [rideType, setRideType] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [fare, setFare] = useState<number | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [routeVisible, setRouteVisible] = useState(false);

  const pickupBoxRef = useRef<HTMLDivElement | null>(null);
  const dropoffBoxRef = useRef<HTMLDivElement | null>(null);
  const pickupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCalculatedKeyRef = useRef("");

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  const canCalculate = useMemo(() => {
    return (
      !!pickupAddress.trim() &&
      !!dropoffAddress.trim() &&
      pickupLat != null &&
      pickupLng != null &&
      dropoffLat != null &&
      dropoffLng != null
    );
  }, [pickupAddress, dropoffAddress, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  const routeKey = useMemo(() => {
    if (!canCalculate) return "";
    return [
      pickupAddress.trim(),
      dropoffAddress.trim(),
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
    ].join("|");
  }, [canCalculate, pickupAddress, dropoffAddress, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  const canSubmit = useMemo(() => {
    if (!customer) return false;
    if (!canCalculate) return false;
    if (distanceKm == null || durationMin == null) return false;
    if (rideType === "scheduled" && !scheduledFor) return false;
    return true;
  }, [customer, canCalculate, distanceKm, durationMin, rideType, scheduledFor]);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token || "";
  }

  async function loadCustomer() {
    setAuthLoading(true);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      router.replace("/customer/auth?next=/book");
      return;
    }

    const res = await fetch("/api/customer/me", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const json = (await res.json()) as CustomerMe;

    if (!json?.ok || !json.customer) {
      router.replace("/customer/auth?next=/book");
      return;
    }

    setCustomer(json.customer);
    setAuthLoading(false);
  }

  async function logout() {
    await supabaseClient.auth.signOut();
    router.push("/customer/auth");
  }

  function resetRouteState() {
    setDistanceKm(null);
    setDurationMin(null);
    setFare(null);
    setRouteVisible(false);
    lastCalculatedKeyRef.current = "";
  }

  function clearPickupSelection() {
    setPickupPlaceId("");
    setPickupLat(null);
    setPickupLng(null);
    resetRouteState();
  }

  function clearDropoffSelection() {
    setDropoffPlaceId("");
    setDropoffLat(null);
    setDropoffLng(null);
    resetRouteState();
  }

  async function reverseGeocode(lat: number, lng: number) {
    const res = await fetch("/api/maps/reverse-geocode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lat, lng }),
    });

    return res.json();
  }

  async function useCurrentLocation() {
    setMsg(null);

    if (!navigator.geolocation) {
      setMsg("This device/browser does not support location.");
      return;
    }

    setBusy(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        setPickupLat(lat);
        setPickupLng(lng);
        setPickupPlaceId("");
        setPickupPredictions([]);
        setShowPickupDropdown(false);
        resetRouteState();

        const json = await reverseGeocode(lat, lng);

        if (json.ok) {
          setPickupAddress(json.address ?? "Current location");
          setMsg("Current pickup location detected ✅");
        } else {
          setPickupAddress("Current location");
          setMsg("Location detected, but address name could not be resolved.");
        }

        setBusy(false);
      },
      (err) => {
        setBusy(false);
        setMsg(`Could not detect current location: ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      }
    );
  }

  async function fetchPredictions(kind: "pickup" | "dropoff", input: string) {
    if (input.trim().length < 3) {
      if (kind === "pickup") {
        setPickupPredictions([]);
        setShowPickupDropdown(false);
        setPickupLoading(false);
      } else {
        setDropoffPredictions([]);
        setShowDropoffDropdown(false);
        setDropoffLoading(false);
      }
      return;
    }

    if (kind === "pickup") setPickupLoading(true);
    if (kind === "dropoff") setDropoffLoading(true);

    try {
      const res = await fetch("/api/maps/autocomplete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        if (kind === "pickup") {
          setPickupPredictions([]);
          setShowPickupDropdown(false);
        } else {
          setDropoffPredictions([]);
          setShowDropoffDropdown(false);
        }
        return;
      }

      const predictions = (json.predictions ?? []) as Prediction[];

      if (kind === "pickup") {
        setPickupPredictions(predictions);
        setShowPickupDropdown(predictions.length > 0);
      } else {
        setDropoffPredictions(predictions);
        setShowDropoffDropdown(predictions.length > 0);
      }
    } finally {
      if (kind === "pickup") setPickupLoading(false);
      if (kind === "dropoff") setDropoffLoading(false);
    }
  }

  function onPickupInputChange(value: string) {
    setPickupAddress(value);
    clearPickupSelection();

    if (pickupTimerRef.current) clearTimeout(pickupTimerRef.current);
    pickupTimerRef.current = setTimeout(() => {
      void fetchPredictions("pickup", value);
    }, 250);
  }

  function onDropoffInputChange(value: string) {
    setDropoffAddress(value);
    clearDropoffSelection();

    if (dropoffTimerRef.current) clearTimeout(dropoffTimerRef.current);
    dropoffTimerRef.current = setTimeout(() => {
      void fetchPredictions("dropoff", value);
    }, 250);
  }

  async function choosePlace(kind: "pickup" | "dropoff", placeId: string, description: string) {
    setMsg(null);

    const res = await fetch("/api/maps/place-details", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ place_id: placeId }),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load place details.");
      return;
    }

    if (kind === "pickup") {
      setPickupAddress(json.formatted_address || description);
      setPickupPlaceId(json.place_id || placeId);
      setPickupLat(typeof json.lat === "number" ? json.lat : null);
      setPickupLng(typeof json.lng === "number" ? json.lng : null);
      setPickupPredictions([]);
      setShowPickupDropdown(false);
    } else {
      setDropoffAddress(json.formatted_address || description);
      setDropoffPlaceId(json.place_id || placeId);
      setDropoffLat(typeof json.lat === "number" ? json.lat : null);
      setDropoffLng(typeof json.lng === "number" ? json.lng : null);
      setDropoffPredictions([]);
      setShowDropoffDropdown(false);
    }

    resetRouteState();
    setMsg(kind === "pickup" ? "Pickup selected ✅" : "Destination selected ✅");
  }

  async function calculateTrip(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;

    if (!silent) setMsg(null);

    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      if (!silent) setMsg("Pickup and destination are required.");
      return false;
    }

    if (
      pickupLat == null ||
      pickupLng == null ||
      dropoffLat == null ||
      dropoffLng == null
    ) {
      if (!silent) setMsg("Please select valid pickup and destination addresses.");
      return false;
    }

    const payload =
      pickupPlaceId && dropoffPlaceId
        ? {
            origin_place_id: pickupPlaceId,
            destination_place_id: dropoffPlaceId,
          }
        : {
            origin_lat: pickupLat,
            origin_lng: pickupLng,
            destination_lat: dropoffLat,
            destination_lng: dropoffLng,
          };

    const res = await fetch("/api/maps/distance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      if (!silent) setMsg(json?.error || "Could not calculate trip distance.");
      return false;
    }

    const km = Number(json.distanceKm ?? 0);
    const mins = Number(json.durationMin ?? 0);
    const estimatedFare = Math.max(40, 25 + km * 7 + mins * 1.2);

    setDistanceKm(Number(km.toFixed(2)));
    setDurationMin(Math.ceil(mins));
    setFare(Math.round(estimatedFare));

    if (!silent) setMsg("Fare calculated ✅");
    return true;
  }

  async function submitBooking() {
    setMsg(null);

    if (!customer) {
      setMsg("Your customer account could not be loaded.");
      return;
    }

    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      setMsg("Pickup and destination are required.");
      return;
    }

    if (
      pickupLat == null ||
      pickupLng == null ||
      dropoffLat == null ||
      dropoffLng == null
    ) {
      setMsg("Please select valid pickup and destination addresses.");
      return;
    }

    if (distanceKm == null || durationMin == null) {
      const calculated = await calculateTrip({ silent: true });
      if (!calculated) {
        setMsg("Waiting for fare calculation. Please try again.");
        return;
      }
    }

    if (rideType === "scheduled" && !scheduledFor) {
      setMsg("Please choose the scheduled pickup date and time.");
      return;
    }

    setBusy(true);

    try {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        router.replace("/customer/auth?next=/book");
        return;
      }

      const res = await fetch("/api/customer/book-trip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          pickupAddress,
          dropoffAddress,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          paymentMethod,
          distanceKm,
          durationMin,
          rideType,
          scheduledFor: rideType === "scheduled" ? scheduledFor : null,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setMsg(json?.error || "Could not create trip.");
        setBusy(false);
        return;
      }

      const bookedFareRaw =
        json?.trip?.fare_amount ??
        json?.fareBreakdown?.totalFare ??
        fare;

      const bookedFare = wholeRand(bookedFareRaw);
      setFare(bookedFare);

      const tripId = json?.tripId ?? json?.trip?.id;
      if (tripId) {
        window.location.href = `/ride/${tripId}`;
        return;
      }

      setMsg(
        rideType === "scheduled"
          ? `Ride scheduled successfully ✅ Estimated fare: R${bookedFare ?? 0}`
          : `Trip booked successfully ✅ Fare: R${bookedFare ?? 0}`
      );
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Could not create trip.");
    }

    setBusy(false);
  }

  function clearMapVisuals() {
    directionsRendererRef.current?.setMap(null);
    directionsRendererRef.current = null;

    if (pickupMarkerRef.current) {
      pickupMarkerRef.current.setMap(null);
      pickupMarkerRef.current = null;
    }

    if (dropoffMarkerRef.current) {
      dropoffMarkerRef.current.setMap(null);
      dropoffMarkerRef.current = null;
    }
  }

  function ensureMap() {
    if (!mapRef.current || !window.google?.maps) return false;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
        center: DEFAULT_CENTER,
        zoom: 12,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      });
    }

    return true;
  }

  function renderPickupOnlyMap() {
    if (!ensureMap() || pickupLat == null || pickupLng == null) return;

    const map = mapInstanceRef.current!;
    clearMapVisuals();
    setRouteVisible(false);

    const pickup = { lat: pickupLat, lng: pickupLng };
    pickupMarkerRef.current = new window.google.maps.Marker({
      map,
      position: pickup,
      title: "Pickup",
    });

    map.setCenter(pickup);
    map.setZoom(15);
  }

  function renderRouteMap() {
    if (
      !ensureMap() ||
      pickupLat == null ||
      pickupLng == null ||
      dropoffLat == null ||
      dropoffLng == null
    ) {
      return;
    }

    const map = mapInstanceRef.current!;
    clearMapVisuals();

    pickupMarkerRef.current = new window.google.maps.Marker({
      map,
      position: { lat: pickupLat, lng: pickupLng },
      title: "Pickup",
    });

    dropoffMarkerRef.current = new window.google.maps.Marker({
      map,
      position: { lat: dropoffLat, lng: dropoffLng },
      title: "Destination",
    });

    const directionsService = new window.google.maps.DirectionsService();
    const directionsRenderer = new window.google.maps.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: {
        strokeColor: "#2563eb",
        strokeOpacity: 0.95,
        strokeWeight: 6,
      },
    });

    directionsRenderer.setMap(map);
    directionsRendererRef.current = directionsRenderer;

    directionsService.route(
      {
        origin: { lat: pickupLat, lng: pickupLng },
        destination: { lat: dropoffLat, lng: dropoffLng },
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK && result) {
          directionsRenderer.setDirections(result);
          setRouteVisible(true);
          return;
        }

        const bounds = new window.google.maps.LatLngBounds();
        bounds.extend({ lat: pickupLat, lng: pickupLng });
        bounds.extend({ lat: dropoffLat, lng: dropoffLng });
        map.fitBounds(bounds);
        setRouteVisible(false);
      }
    );
  }

  useEffect(() => {
    loadCustomer();

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;

      if (pickupBoxRef.current && !pickupBoxRef.current.contains(target)) {
        setShowPickupDropdown(false);
      }

      if (dropoffBoxRef.current && !dropoffBoxRef.current.contains(target)) {
        setShowDropoffDropdown(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (pickupTimerRef.current) clearTimeout(pickupTimerRef.current);
      if (dropoffTimerRef.current) clearTimeout(dropoffTimerRef.current);
    };
  }, [router]);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      setMapError("Google Maps API key is missing. Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.");
      return;
    }

    if (window.google?.maps) {
      setMapReady(true);
      setMapError(null);
      return;
    }

    const existingScript = document.getElementById(
      "google-maps-script-booking"
    ) as HTMLScriptElement | null;

    const onLoaded = () => {
      setMapReady(true);
      setMapError(null);
    };

    const onError = () => {
      setMapError("Google Maps failed to load on the booking page.");
    };

    if (existingScript) {
      existingScript.addEventListener("load", onLoaded);
      existingScript.addEventListener("error", onError);

      return () => {
        existingScript.removeEventListener("load", onLoaded);
        existingScript.removeEventListener("error", onError);
      };
    }

    const script = document.createElement("script");
    script.id = "google-maps-script-booking";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", onLoaded);
    script.addEventListener("error", onError);
    document.head.appendChild(script);

    return () => {
      script.removeEventListener("load", onLoaded);
      script.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    if (!ensureMap()) return;

    if (pickupLat != null && pickupLng != null && dropoffLat != null && dropoffLng != null) {
      renderRouteMap();
      return;
    }

    if (pickupLat != null && pickupLng != null) {
      renderPickupOnlyMap();
      return;
    }

    clearMapVisuals();
    setRouteVisible(false);

    if (mapInstanceRef.current) {
      mapInstanceRef.current.setCenter(DEFAULT_CENTER);
      mapInstanceRef.current.setZoom(11);
    }
  }, [mapReady, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  useEffect(() => {
    if (!canCalculate || !routeKey) return;

    if (lastCalculatedKeyRef.current === routeKey) return;
    lastCalculatedKeyRef.current = routeKey;

    void calculateTrip({ silent: true });
  }, [canCalculate, routeKey]);

  if (authLoading) {
    return (
      <main className="moovu-page moovu-shell p-6 text-black">
        Loading your booking account...
      </main>
    );
  }

  return (
    <main className="moovu-page text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-shell">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="moovu-section-title">MOOVU Rider</div>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950 md:text-4xl">
              Book your ride
            </h1>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="moovu-chip">
              <span className="moovu-chip-dot" />
              {customer?.first_name} {customer?.last_name}
            </div>

            <button className="moovu-btn moovu-btn-secondary" onClick={logout}>
              Logout
            </button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="moovu-panel overflow-hidden p-4 md:p-6">
            <div>
              <div className="text-sm font-medium text-slate-500">Request a ride</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950">
                Set your trip details
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex justify-end">
                <button
                  className="moovu-btn moovu-btn-primary"
                  onClick={useCurrentLocation}
                  disabled={busy}
                >
                  Use my location
                </button>
              </div>

              <div className="relative" ref={pickupBoxRef}>
                <div className="flex items-center gap-3 rounded-[20px] border border-[var(--moovu-border)] bg-white px-4 py-4">
                  <div className="h-3 w-3 rounded-full bg-[var(--moovu-primary)]" />
                  <input
                    className="w-full border-0 bg-transparent p-0 outline-none focus:shadow-none"
                    placeholder="Pickup location"
                    value={pickupAddress}
                    onChange={(e) => onPickupInputChange(e.target.value)}
                    onFocus={() => {
                      if (pickupPredictions.length > 0) setShowPickupDropdown(true);
                    }}
                  />
                </div>

                {pickupLoading && (
                  <div className="px-3 pt-2 text-xs text-slate-500">
                    Searching pickup locations...
                  </div>
                )}

                {showPickupDropdown && pickupPredictions.length > 0 && (
                  <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-[var(--moovu-border)] bg-white shadow-xl">
                    {pickupPredictions.map((item) => (
                      <button
                        key={item.place_id}
                        type="button"
                        className="block w-full border-b border-slate-100 px-4 py-3 text-left text-sm hover:bg-slate-50 last:border-b-0"
                        onClick={() => void choosePlace("pickup", item.place_id, item.description)}
                      >
                        {item.description}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative" ref={dropoffBoxRef}>
                <div className="flex items-center gap-3 rounded-[20px] border border-[var(--moovu-border)] bg-white px-4 py-4">
                  <div className="h-3 w-3 rounded-full bg-slate-900" />
                  <input
                    className="w-full border-0 bg-transparent p-0 outline-none focus:shadow-none"
                    placeholder="Where are you going?"
                    value={dropoffAddress}
                    onChange={(e) => onDropoffInputChange(e.target.value)}
                    onFocus={() => {
                      if (dropoffPredictions.length > 0) setShowDropoffDropdown(true);
                    }}
                  />
                </div>

                {dropoffLoading && (
                  <div className="px-3 pt-2 text-xs text-slate-500">
                    Searching destinations...
                  </div>
                )}

                {showDropoffDropdown && dropoffPredictions.length > 0 && (
                  <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-[var(--moovu-border)] bg-white shadow-xl">
                    {dropoffPredictions.map((item) => (
                      <button
                        key={item.place_id}
                        type="button"
                        className="block w-full border-b border-slate-100 px-4 py-3 text-left text-sm hover:bg-slate-50 last:border-b-0"
                        onClick={() => void choosePlace("dropoff", item.place_id, item.description)}
                      >
                        {item.description}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium text-slate-600">When</div>
                <div className="grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
                  <button
                    type="button"
                    className={`rounded-xl px-4 py-3 text-sm font-medium transition ${
                      rideType === "now" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"
                    }`}
                    onClick={() => setRideType("now")}
                  >
                    Ride now
                  </button>

                  <button
                    type="button"
                    className={`rounded-xl px-4 py-3 text-sm font-medium transition ${
                      rideType === "scheduled"
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-600"
                    }`}
                    onClick={() => setRideType("scheduled")}
                  >
                    Schedule
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-slate-600">Payment</div>
                <div className="grid grid-cols-1 rounded-2xl bg-slate-100 p-1">
                  <button
                    type="button"
                    className={`rounded-xl px-4 py-3 text-sm font-medium transition ${
                      paymentMethod === "cash"
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-600"
                    }`}
                    onClick={() => setPaymentMethod("cash")}
                  >
                    Cash
                  </button>
                </div>
              </div>
            </div>

            {rideType === "scheduled" && (
              <div className="mt-4">
                <div className="mb-2 text-sm font-medium text-slate-600">Scheduled pickup</div>
                <input
                  type="datetime-local"
                  className="moovu-input"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              </div>
            )}

            <div className="mt-5 rounded-[28px] border border-[var(--moovu-border)] bg-[var(--moovu-bg-soft)] p-4">
              {mapError ? (
                <div className="flex h-[320px] items-center justify-center rounded-[22px] bg-white px-6 text-center text-sm text-rose-600">
                  {mapError}
                </div>
              ) : (
                <div
                  ref={mapRef}
                  className="h-[320px] rounded-[22px] border border-slate-200 bg-white"
                />
              )}
            </div>

            <div className="mt-4 text-sm text-slate-500">
              {routeVisible
                ? "Route loaded from pickup to destination."
                : pickupLat != null && pickupLng != null
                ? "Pickup is on the map. Add destination to draw the trip route."
                : "Choose your pickup and destination to load the live map route."}
            </div>

            <button
              className="mt-4 w-full rounded-[22px] bg-[var(--moovu-primary)] px-6 py-4 text-base font-semibold text-white shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void submitBooking()}
              disabled={busy || !canSubmit}
            >
              {busy
                ? rideType === "scheduled"
                  ? "Scheduling..."
                  : "Booking..."
                : rideType === "scheduled"
                ? "Schedule ride"
                : "Confirm ride"}
            </button>
          </section>

          <aside className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
              <div className="moovu-stat-card">
                <div className="moovu-stat-label">Distance</div>
                <div className="moovu-stat-value">
                  {distanceKm != null ? `${distanceKm} km` : "—"}
                </div>
              </div>

              <div className="moovu-stat-card">
                <div className="moovu-stat-label">Duration</div>
                <div className="moovu-stat-value">
                  {durationMin != null ? `${durationMin} min` : "—"}
                </div>
              </div>

              <div className="moovu-stat-card moovu-stat-card-primary">
                <div className="moovu-stat-label">Estimated fare</div>
                <div className="moovu-stat-value">{money(fare)}</div>
              </div>
            </div>

            <div className="moovu-card p-5">
              <div className="moovu-section-title">Trip summary</div>

              <div className="mt-4 space-y-4">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Pickup</div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    {pickupAddress || "Set pickup location"}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Destination
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    {dropoffAddress || "Set destination"}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">Trip type</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {rideType === "now" ? "Ride now" : "Scheduled"}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">Payment</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 capitalize">
                      {paymentMethod}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-blue-100 bg-[var(--moovu-primary-soft)] p-4 text-sm text-slate-700">
                  Pricing model: base fare R25 + R7/km + R1.20/min.
                </div>
              </div>
            </div>

            <div className="moovu-card p-5">
              <div className="text-sm font-medium text-slate-500">Account</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">
                {customer?.first_name} {customer?.last_name}
              </div>
              <div className="mt-1 text-sm text-slate-600">{customer?.phone}</div>

              <div className="mt-4 flex flex-col gap-3">
                <Link href="/ride/history" className="moovu-btn moovu-btn-secondary w-full">
                  My trip history
                </Link>

                <button className="moovu-btn moovu-btn-secondary w-full" onClick={logout}>
                  Logout
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}