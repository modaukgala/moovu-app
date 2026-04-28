"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import EnablePushButton from "@/components/EnablePushButton";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import {
  DEFAULT_RIDE_OPTION_ID,
  RIDE_OPTIONS,
  calculateTripFare,
  type RideOptionId,
} from "@/lib/domain/fare";
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

type LocationKind = "pickup" | "dropoff";

type ResolvedLocation = {
  address: string;
  placeId: string;
  lat: number;
  lng: number;
};

// TASK 4 — ride option definition
const DEFAULT_CENTER = { lat: -26.188, lng: 28.3206 };

function money(value: number | null | undefined) {
  return value == null ? "R--" : `R${Math.round(Number(value))}`;
}

function formatDistance(value: number | null) {
  return value == null ? "--" : `${value} km`;
}

function formatDuration(value: number | null) {
  return value == null ? "--" : `${value} min`;
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

  // TASK 2 — inline resolution states
  const [pickupError, setPickupError] = useState<string | null>(null);
  const [dropoffError, setDropoffError] = useState<string | null>(null);
  const [pickupResolving, setPickupResolving] = useState(false);
  const [dropoffResolving, setDropoffResolving] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [rideType, setRideType] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState("");

  // TASK 4 — selected ride option
  const [selectedRideOption, setSelectedRideOption] =
    useState<RideOptionId>(DEFAULT_RIDE_OPTION_ID);

  const [busy, setBusy] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [baseFare, setBaseFare] = useState<number | null>(null);

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

  // TASK 4 — fare adjusted by ride option multiplier
  const fare = useMemo(() => {
    if (distanceKm == null || durationMin == null) return null;
    return calculateTripFare({
      distanceKm,
      durationMin,
      rideOptionId: selectedRideOption,
    }).totalFare;
  }, [distanceKm, durationMin, selectedRideOption]);

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
    return [pickupAddress.trim(), dropoffAddress.trim(), pickupLat, pickupLng, dropoffLat, dropoffLng].join("|");
  }, [canCalculate, pickupAddress, dropoffAddress, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  const canSubmit = useMemo(() => {
    if (!customer) return false;
    if (!canCalculate) return false;
    if (distanceKm == null || durationMin == null || fare == null) return false;
    if (rideType === "scheduled" && !scheduledFor) return false;
    return true;
  }, [customer, canCalculate, distanceKm, durationMin, fare, rideType, scheduledFor]);

  const progressText = useMemo(() => {
    if (!pickupAddress.trim()) return "Set your pickup point";
    if (!dropoffAddress.trim()) return "Add your destination";
    if (!canCalculate) return "Resolving locations\u2026";
    if (fare == null) return "Calculating your fare";
    return routeVisible ? "Route ready" : "Trip details ready";
  }, [canCalculate, dropoffAddress, fare, pickupAddress, routeVisible]);

  async function getAccessToken() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session?.access_token || "";
  }

  async function loadCustomer() {
    setAuthLoading(true);
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
      router.replace("/customer/auth?next=/book");
      return;
    }

    const res = await fetch("/api/customer/me", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
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
    setBaseFare(null);
    setRouteVisible(false);
    lastCalculatedKeyRef.current = "";
  }

  function clearPickupSelection() {
    setPickupPlaceId("");
    setPickupLat(null);
    setPickupLng(null);
    setPickupError(null);
    resetRouteState();
  }

  function clearDropoffSelection() {
    setDropoffPlaceId("");
    setDropoffLat(null);
    setDropoffLng(null);
    setDropoffError(null);
    resetRouteState();
  }

  async function reverseGeocode(lat: number, lng: number): Promise<{
    ok: boolean;
    address?: string;
    error?: string;
  } | null> {
    const res = await fetch("/api/maps/reverse-geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    });
    return res.json().catch(() => null);
  }

  function getLocationErrorMessage(error: GeolocationPositionError) {
    if (error.code === error.PERMISSION_DENIED) {
      return "Location permission is blocked. Allow location access for MOOVU in your browser or app settings, then tap Use my location again.";
    }

    if (error.code === error.POSITION_UNAVAILABLE) {
      return "MOOVU could not detect your current GPS position. Check that location services are enabled, or type your pickup address.";
    }

    if (error.code === error.TIMEOUT) {
      return "MOOVU is taking too long to detect your location. Try again, move to an open area, or type your pickup address.";
    }

    return "MOOVU could not detect your current location. Type your pickup address or try again.";
  }

  function isGeolocationPositionError(error: unknown): error is GeolocationPositionError {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "number"
    );
  }

  function requestCurrentPosition() {
    return new Promise<GeolocationPosition>((resolve, reject: (error: GeolocationPositionError) => void) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 60000,
      });
    });
  }

  // TASK 2 — resolve typed text via autocomplete + geocode, auto-selecting first result
  async function resolveTypedLocation(
    kind: LocationKind,
    text: string
  ): Promise<ResolvedLocation | null> {
    const input = text.trim();
    if (!input) return null;

    if (kind === "pickup" && pickupLat != null && pickupLng != null) {
      return {
        address: pickupAddress.trim(),
        placeId: pickupPlaceId,
        lat: pickupLat,
        lng: pickupLng,
      };
    }

    if (kind === "dropoff" && dropoffLat != null && dropoffLng != null) {
      return {
        address: dropoffAddress.trim(),
        placeId: dropoffPlaceId,
        lat: dropoffLat,
        lng: dropoffLng,
      };
    }

    if (kind === "pickup") { setPickupResolving(true); setPickupError(null); }
    else { setDropoffResolving(true); setDropoffError(null); }

    if (kind === "pickup") {
      if (pickupTimerRef.current) clearTimeout(pickupTimerRef.current);
      setPickupPredictions([]);
      setShowPickupDropdown(false);
    } else {
      if (dropoffTimerRef.current) clearTimeout(dropoffTimerRef.current);
      setDropoffPredictions([]);
      setShowDropoffDropdown(false);
    }

    try {
      // Try autocomplete -> place-details first
      const acRes = await fetch("/api/maps/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const acJson = await acRes.json().catch(() => null);

      if (acJson?.ok && acJson.predictions?.length > 0) {
        const first = acJson.predictions[0] as Prediction;
        const detailRes = await fetch("/api/maps/place-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place_id: first.place_id }),
        });
        const detail = await detailRes.json().catch(() => null);

        if (detail?.ok && typeof detail.lat === "number" && typeof detail.lng === "number") {
          const resolved = {
            address: detail.formatted_address || first.description,
            placeId: detail.place_id || first.place_id,
            lat: detail.lat,
            lng: detail.lng,
          };

          if (kind === "pickup") {
            setPickupAddress(resolved.address);
            setPickupPlaceId(resolved.placeId);
            setPickupLat(detail.lat);
            setPickupLng(detail.lng);
            setPickupPredictions([]);
            setShowPickupDropdown(false);
          } else {
            setDropoffAddress(resolved.address);
            setDropoffPlaceId(resolved.placeId);
            setDropoffLat(detail.lat);
            setDropoffLng(detail.lng);
            setDropoffPredictions([]);
            setShowDropoffDropdown(false);
          }
          resetRouteState();
          return resolved;
        }
      }

      // Fallback to geocode endpoint
      const geoRes = await fetch("/api/maps/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place: input }),
      });
      const geo = await geoRes.json().catch(() => null);

      if (geo?.ok && typeof geo.lat === "number" && typeof geo.lng === "number") {
        const resolved = {
          address: geo.address || input,
          placeId: "",
          lat: geo.lat,
          lng: geo.lng,
        };

        if (kind === "pickup") {
          setPickupAddress(resolved.address);
          setPickupPlaceId("");
          setPickupLat(geo.lat);
          setPickupLng(geo.lng);
          setPickupPredictions([]);
          setShowPickupDropdown(false);
        } else {
          setDropoffAddress(resolved.address);
          setDropoffPlaceId("");
          setDropoffLat(geo.lat);
          setDropoffLng(geo.lng);
          setDropoffPredictions([]);
          setShowDropoffDropdown(false);
        }
        resetRouteState();
        return resolved;
      }

      if (kind === "pickup") setPickupError("Please choose a valid pickup location.");
      else setDropoffError("Please choose a valid destination.");
      return null;
    } finally {
      if (kind === "pickup") setPickupResolving(false);
      else setDropoffResolving(false);
    }
  }

  async function useCurrentLocation() {
    setMsg(null);
    setPickupError(null);

    if (typeof window === "undefined" || !navigator.geolocation) {
      setMsg("This device/browser does not support location.");
      return;
    }

    setLocationLoading(true);

    try {
      const permission = await navigator.permissions
        ?.query({ name: "geolocation" as PermissionName })
        .catch(() => null);

      if (permission?.state === "denied") {
        const message =
          "Location permission is blocked. Allow location access for MOOVU in your browser or app settings, then tap Use my location again.";
        setPickupError(message);
        setMsg(message);
        return;
      }

      const position = await requestCurrentPosition();
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const fallbackAddress = `Current location (${lat.toFixed(5)}, ${lng.toFixed(5)})`;

      setPickupLat(lat);
      setPickupLng(lng);
      setPickupPlaceId("");
      setPickupPredictions([]);
      setShowPickupDropdown(false);
      setPickupError(null);
      resetRouteState();

      const json = await reverseGeocode(lat, lng).catch(() => null);
      const address = json?.ok && json.address ? json.address : fallbackAddress;

      setPickupAddress(address);
      setMsg(
        json?.ok
          ? "Current pickup location detected."
          : "Location detected. Address name could not be resolved, but GPS is saved."
      );
    } catch (error) {
      const message = isGeolocationPositionError(error)
        ? getLocationErrorMessage(error)
        : "MOOVU could not detect your current location. Type your pickup address or try again.";

      setPickupError(message);
      setMsg(message);
    } finally {
      setLocationLoading(false);
    }
  }

  async function fetchPredictions(kind: "pickup" | "dropoff", input: string) {
    if (input.trim().length < 3) {
      if (kind === "pickup") { setPickupPredictions([]); setShowPickupDropdown(false); setPickupLoading(false); }
      else { setDropoffPredictions([]); setShowDropoffDropdown(false); setDropoffLoading(false); }
      return;
    }

    if (kind === "pickup") setPickupLoading(true);
    if (kind === "dropoff") setDropoffLoading(true);

    try {
      const res = await fetch("/api/maps/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        if (kind === "pickup") { setPickupPredictions([]); setShowPickupDropdown(false); }
        else { setDropoffPredictions([]); setShowDropoffDropdown(false); }
        return;
      }

      const predictions = (json.predictions ?? []) as Prediction[];

      if (kind === "pickup") { setPickupPredictions(predictions); setShowPickupDropdown(predictions.length > 0); }
      else { setDropoffPredictions(predictions); setShowDropoffDropdown(predictions.length > 0); }
    } finally {
      if (kind === "pickup") setPickupLoading(false);
      if (kind === "dropoff") setDropoffLoading(false);
    }
  }

  function onPickupInputChange(value: string) {
    setPickupAddress(value);
    clearPickupSelection();
    if (pickupTimerRef.current) clearTimeout(pickupTimerRef.current);
    pickupTimerRef.current = setTimeout(() => { void fetchPredictions("pickup", value); }, 250);
  }

  function onDropoffInputChange(value: string) {
    setDropoffAddress(value);
    clearDropoffSelection();
    if (dropoffTimerRef.current) clearTimeout(dropoffTimerRef.current);
    dropoffTimerRef.current = setTimeout(() => { void fetchPredictions("dropoff", value); }, 250);
  }

  // TASK 2 — resolve on blur if not already resolved
  async function onPickupBlur() {
    setShowPickupDropdown(false);
    if (pickupAddress.trim() && pickupLat == null) {
      await resolveTypedLocation("pickup", pickupAddress);
    }
  }

  async function onDropoffBlur() {
    setShowDropoffDropdown(false);
    if (dropoffAddress.trim() && dropoffLat == null) {
      await resolveTypedLocation("dropoff", dropoffAddress);
    }
  }

  async function choosePlace(kind: "pickup" | "dropoff", placeId: string, description: string) {
    setMsg(null);

    const res = await fetch("/api/maps/place-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      setPickupError(null);
    } else {
      setDropoffAddress(json.formatted_address || description);
      setDropoffPlaceId(json.place_id || placeId);
      setDropoffLat(typeof json.lat === "number" ? json.lat : null);
      setDropoffLng(typeof json.lng === "number" ? json.lng : null);
      setDropoffPredictions([]);
      setShowDropoffDropdown(false);
      setDropoffError(null);
    }

    resetRouteState();
  }

  function currentResolvedLocation(kind: LocationKind): ResolvedLocation | null {
    if (kind === "pickup") {
      if (pickupLat == null || pickupLng == null) return null;
      return {
        address: pickupAddress.trim(),
        placeId: pickupPlaceId,
        lat: pickupLat,
        lng: pickupLng,
      };
    }

    if (dropoffLat == null || dropoffLng == null) return null;
    return {
      address: dropoffAddress.trim(),
      placeId: dropoffPlaceId,
      lat: dropoffLat,
      lng: dropoffLng,
    };
  }

  async function ensureResolvedRoute() {
    const pickup =
      currentResolvedLocation("pickup") ?? (await resolveTypedLocation("pickup", pickupAddress));
    const dropoff =
      currentResolvedLocation("dropoff") ?? (await resolveTypedLocation("dropoff", dropoffAddress));

    if (!pickup) {
      setPickupError("Please choose a valid pickup location.");
      return null;
    }

    if (!dropoff) {
      setDropoffError("Please choose a valid destination.");
      return null;
    }

    return { pickup, dropoff };
  }

  async function calculateTrip(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (!silent) setMsg(null);

    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      if (!silent) setMsg("Pickup and destination are required.");
      return null;
    }

    const route = await ensureResolvedRoute();

    if (!route) {
      if (!silent) setMsg("Please choose valid pickup and destination locations.");
      return null;
    }

    const payload =
      route.pickup.placeId && route.dropoff.placeId
        ? { origin_place_id: route.pickup.placeId, destination_place_id: route.dropoff.placeId }
        : {
            origin_lat: route.pickup.lat,
            origin_lng: route.pickup.lng,
            destination_lat: route.dropoff.lat,
            destination_lng: route.dropoff.lng,
          };

    const res = await fetch("/api/maps/distance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      if (!silent) setMsg(json?.error || "Could not calculate trip distance.");
      return null;
    }

    const km = Number(json.distanceKm ?? 0);
    const mins = Number(json.durationMin ?? 0);
    const estimatedFare = calculateTripFare({
      distanceKm: km,
      durationMin: mins,
      rideOptionId: DEFAULT_RIDE_OPTION_ID,
    });

    const roundedDistanceKm = Number(km.toFixed(2));
    const roundedDurationMin = Math.ceil(mins);

    setDistanceKm(roundedDistanceKm);
    setDurationMin(roundedDurationMin);
    setBaseFare(estimatedFare.totalFare);

    return {
      distanceKm: roundedDistanceKm,
      durationMin: roundedDurationMin,
    };
  }

  async function submitBooking() {
    setMsg(null);

    if (!customer) { setMsg("Your customer account could not be loaded."); return; }
    if (!pickupAddress.trim() || !dropoffAddress.trim()) { setMsg("Pickup and destination are required."); return; }

    // TASK 2 — resolve unresolved inputs before submission
    const route = await ensureResolvedRoute();

    if (!route) {
      setMsg("Please fix the location errors before confirming.");
      return;
    }

    let bookingDistanceKm = distanceKm;
    let bookingDurationMin = durationMin;

    if (distanceKm == null || durationMin == null) {
      const calculated = await calculateTrip({ silent: true });
      if (!calculated) { setMsg("Waiting for fare calculation. Please try again."); return; }
      bookingDistanceKm = calculated.distanceKm;
      bookingDurationMin = calculated.durationMin;
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

      const finalFare =
        bookingDistanceKm != null && bookingDurationMin != null
          ? calculateTripFare({
              distanceKm: bookingDistanceKm,
              durationMin: bookingDurationMin,
              rideOptionId: selectedRideOption,
            }).totalFare
          : fare ?? baseFare ?? 0;
      const rideOptionLabel = RIDE_OPTIONS.find((o) => o.id === selectedRideOption)?.name ?? "MOOVU Go";

      const res = await fetch("/api/customer/book-trip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          pickupAddress: route.pickup.address || pickupAddress,
          dropoffAddress: route.dropoff.address || dropoffAddress,
          pickupLat: route.pickup.lat,
          pickupLng: route.pickup.lng,
          dropoffLat: route.dropoff.lat,
          dropoffLng: route.dropoff.lng,
          paymentMethod,
          distanceKm: bookingDistanceKm,
          durationMin: bookingDurationMin,
          rideType,
          rideOption: selectedRideOption,
          scheduledFor: rideType === "scheduled" ? scheduledFor : null,
          fare_amount: finalFare,
          notes: `Ride option: ${rideOptionLabel}`,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setMsg(json?.error || "Could not create trip.");
        setBusy(false);
        return;
      }

      const tripId = json?.tripId ?? json?.trip?.id;
      if (tripId) {
        window.location.href = `/ride/${tripId}`;
        return;
      }

      setMsg(
        rideType === "scheduled"
          ? `Ride scheduled. Fare: ${money(finalFare)}`
          : `Trip booked. Fare: ${money(finalFare)}`
      );
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Could not create trip.");
    }

    setBusy(false);
  }

  function clearMapVisuals() {
    directionsRendererRef.current?.setMap(null);
    directionsRendererRef.current = null;
    if (pickupMarkerRef.current) { pickupMarkerRef.current.setMap(null); pickupMarkerRef.current = null; }
    if (dropoffMarkerRef.current) { dropoffMarkerRef.current.setMap(null); dropoffMarkerRef.current = null; }
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
    pickupMarkerRef.current = new window.google.maps.Marker({ map, position: pickup, title: "Pickup" });
    map.setCenter(pickup);
    map.setZoom(15);
  }

  function renderRouteMap() {
    if (!ensureMap() || pickupLat == null || pickupLng == null || dropoffLat == null || dropoffLng == null) return;

    const map = mapInstanceRef.current!;
    clearMapVisuals();

    pickupMarkerRef.current = new window.google.maps.Marker({ map, position: { lat: pickupLat, lng: pickupLng }, title: "Pickup" });
    dropoffMarkerRef.current = new window.google.maps.Marker({ map, position: { lat: dropoffLat, lng: dropoffLng }, title: "Destination" });

    const directionsService = new window.google.maps.DirectionsService();
    const directionsRenderer = new window.google.maps.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: "#1F74C9", strokeOpacity: 0.95, strokeWeight: 6 },
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
      if (pickupBoxRef.current && !pickupBoxRef.current.contains(target)) setShowPickupDropdown(false);
      if (dropoffBoxRef.current && !dropoffBoxRef.current.contains(target)) setShowDropoffDropdown(false);
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

    if (window.google?.maps) { setMapReady(true); setMapError(null); return; }

    const existingScript = document.getElementById("google-maps-script-booking") as HTMLScriptElement | null;
    const onLoaded = () => { setMapReady(true); setMapError(null); };
    const onError = () => { setMapError("Google Maps failed to load on the booking page."); };

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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
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

    if (pickupLat != null && pickupLng != null && dropoffLat != null && dropoffLng != null) { renderRouteMap(); return; }
    if (pickupLat != null && pickupLng != null) { renderPickupOnlyMap(); return; }

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
      <main className="moovu-booking-loading text-black">
        <div className="moovu-loading-shell">
          <Image src="/logo.png" alt="MOOVU Kasi Rides" width={152} height={92} priority />
          <div className="moovu-loading-card">
            <div className="moovu-skeleton h-4 w-36" />
            <div className="moovu-skeleton h-10 w-full" />
            <div className="moovu-skeleton h-20 w-full" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="moovu-booking-page text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-booking-map-shell">
        {mapError ? (
          <div className="moovu-booking-map-error">{mapError}</div>
        ) : (
          <div ref={mapRef} className="moovu-booking-map" />
        )}
      </div>

      {/* TASK 3 — Trips + Logout in header. Old "Ride history" button below inputs removed. */}
      <header className="moovu-booking-header">
        <div className="moovu-brand-lockup">
          <Image src="/logo.png" alt="MOOVU Kasi Rides" width={96} height={58} priority />
          <div>
            <div className="moovu-kicker">Kasi Rides</div>
            <div className="text-sm font-bold text-slate-950">Book a ride</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/ride/history" className="moovu-icon-link" aria-label="Ride history">
            Trips
          </Link>
          <button className="moovu-icon-link" onClick={logout} aria-label="Logout">
            Logout
          </button>
        </div>
      </header>

      <section className="moovu-booking-panel" aria-label="Ride booking">
        <div className="moovu-bottom-sheet-handle" />

        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="moovu-kicker">MOOVU Rider</div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
              Where to?
            </h1>
            <p className="mt-1 text-sm text-slate-600">{progressText}</p>
          </div>

          <div className="moovu-account-pill">
            <span className="moovu-account-dot" />
            <span>{customer?.first_name || "Rider"}</span>
          </div>
        </div>

        <div className="mt-5 rounded-[28px] border border-[var(--moovu-border)] bg-white p-3 shadow-sm">
          {/* PICKUP */}
          <div className="moovu-route-field" ref={pickupBoxRef}>
            <div className="moovu-route-marker-wrap">
              <span className="moovu-route-dot moovu-route-dot-pickup" />
              <span className="moovu-route-line" />
            </div>
            <div className="min-w-0 flex-1">
              {/* TASK 1 — inline "My location" button beside pickup label */}
              <div className="flex items-center justify-between gap-2">
                <label className="moovu-field-label" htmlFor="pickup-input">
                  Pickup
                </label>
                <button
                  type="button"
                  className="moovu-loc-inline-btn"
                  onClick={useCurrentLocation}
                  disabled={busy || locationLoading}
                  aria-busy={locationLoading}
                  title="Use my current location"
                  aria-label="Use my current location"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="8" cy="8" r="3" fill="currentColor" />
                    <path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <span>{locationLoading ? "Locating..." : "My location"}</span>
                </button>
              </div>
              <input
                id="pickup-input"
                className="moovu-route-input"
                placeholder="Pickup location"
                value={pickupAddress}
                onChange={(e) => onPickupInputChange(e.target.value)}
                onBlur={() => void onPickupBlur()}
                onFocus={() => { if (pickupPredictions.length > 0) setShowPickupDropdown(true); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onPickupBlur(); } }}
              />
              {pickupLoading && <div className="moovu-field-hint">Searching pickup locations\u2026</div>}
              {pickupResolving && <div className="moovu-field-hint">Resolving location\u2026</div>}
              {pickupError && <div className="moovu-field-error">{pickupError}</div>}
              {showPickupDropdown && pickupPredictions.length > 0 && (
                <div className="moovu-place-menu">
                  {pickupPredictions.map((item) => (
                    <button key={item.place_id} type="button" className="moovu-place-option" onClick={() => void choosePlace("pickup", item.place_id, item.description)}>
                      {item.description}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* DESTINATION */}
          <div className="moovu-route-field" ref={dropoffBoxRef}>
            <div className="moovu-route-marker-wrap">
              <span className="moovu-route-dot moovu-route-dot-dropoff" />
            </div>
            <div className="min-w-0 flex-1">
              <label className="moovu-field-label" htmlFor="dropoff-input">
                Destination
              </label>
              <input
                id="dropoff-input"
                className="moovu-route-input"
                placeholder="Where are you going?"
                value={dropoffAddress}
                onChange={(e) => onDropoffInputChange(e.target.value)}
                onBlur={() => void onDropoffBlur()}
                onFocus={() => { if (dropoffPredictions.length > 0) setShowDropoffDropdown(true); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onDropoffBlur(); } }}
              />
              {dropoffLoading && <div className="moovu-field-hint">Searching destinations\u2026</div>}
              {dropoffResolving && <div className="moovu-field-hint">Resolving location\u2026</div>}
              {dropoffError && <div className="moovu-field-error">{dropoffError}</div>}
              {showDropoffDropdown && dropoffPredictions.length > 0 && (
                <div className="moovu-place-menu">
                  {dropoffPredictions.map((item) => (
                    <button key={item.place_id} type="button" className="moovu-place-option" onClick={() => void choosePlace("dropoff", item.place_id, item.description)}>
                      {item.description}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* TASK 4 — MOOVU Go / MOOVU Group cards (no "Standard", passenger limits shown) */}
        {distanceKm != null && durationMin != null && (
        <div className="moovu-ride-options-sheet mt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="moovu-field-label">Choose your ride</div>
              <div className="mt-1 text-sm font-semibold text-slate-600">
                {formatDistance(distanceKm)} · {formatDuration(durationMin)}
              </div>
            </div>
            <div className={routeVisible ? "moovu-status-pill-ready" : "moovu-status-pill"}>
              {routeVisible ? "Route ready" : "Planning"}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {RIDE_OPTIONS.map((opt) => {
              const active = selectedRideOption === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`moovu-ride-option-card text-left${active ? " active" : ""}`}
                  onClick={() => setSelectedRideOption(opt.id)}
                  aria-pressed={active}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-black text-slate-950">{opt.name}</div>
                      <div className="mt-0.5 text-xs font-semibold text-slate-500">{opt.capacity}</div>
                    </div>
                    <div className="text-sm font-black text-[var(--moovu-primary)]">
                      {money(
                        calculateTripFare({
                          distanceKm,
                          durationMin,
                          rideOptionId: opt.id,
                        }).totalFare
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-xs leading-4 text-slate-600">{opt.description}</div>
                </button>
              );
            })}
          </div>
        </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="moovu-control-card">
            <div className="moovu-field-label">When</div>
            <div className="moovu-segmented mt-2">
              <button type="button" className={rideType === "now" ? "moovu-segmented-active" : ""} onClick={() => setRideType("now")}>
                Ride now
              </button>
              <button type="button" className={rideType === "scheduled" ? "moovu-segmented-active" : ""} onClick={() => setRideType("scheduled")}>
                Schedule
              </button>
            </div>
          </div>

          <div className="moovu-control-card">
            <div className="moovu-field-label">Payment</div>
            <button
              type="button"
              className="mt-2 min-h-11 w-full rounded-2xl bg-slate-100 px-4 text-sm font-bold text-slate-950"
              onClick={() => setPaymentMethod("cash")}
            >
              {paymentMethod === "cash" ? "Cash" : paymentMethod}
            </button>
          </div>
        </div>

        {rideType === "scheduled" && (
          <div className="mt-3">
            <label className="moovu-field-label" htmlFor="scheduled-for">
              Scheduled pickup
            </label>
            <input
              id="scheduled-for"
              type="datetime-local"
              className="moovu-input mt-2"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          </div>
        )}

        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="moovu-trip-metric">
            <span>Distance</span>
            <strong>{formatDistance(distanceKm)}</strong>
          </div>
          <div className="moovu-trip-metric">
            <span>Time</span>
            <strong>{formatDuration(durationMin)}</strong>
          </div>
          <div className="moovu-trip-metric moovu-trip-metric-primary">
            <span>Fare</span>
            <strong>{money(fare)}</strong>
          </div>
        </div>

        {/* TASK 5 — pricing formula hidden, customer-friendly message only */}
        <div className="mt-3 rounded-[24px] border border-[#d7e2ea] bg-[#f6fafc] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                Trip summary
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-950">
                {pickupAddress || "Set pickup"} &rarr; {dropoffAddress || "set destination"}
              </div>
            </div>
            <div className={routeVisible ? "moovu-status-pill-ready" : "moovu-status-pill"}>
              {routeVisible ? "Route ready" : "Planning"}
            </div>
          </div>
          <div className="mt-3 text-xs leading-5 text-slate-500">
            Final fare is confirmed before booking.
          </div>
        </div>

        <div className="mt-3 rounded-[24px] border border-[#cfe4ff] bg-[#eef7ff] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-bold text-slate-950">Ride updates</div>
              <div className="mt-1 text-xs leading-5 text-slate-600">
                Enable alerts for driver accepted, arrived, started, and completed updates.
              </div>
            </div>
            <EnablePushButton role="customer" variant="inline" />
          </div>
        </div>

        <div className="moovu-booking-actions">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Estimated total
            </div>
            <div className="text-2xl font-black text-slate-950">{money(fare)}</div>
          </div>
          <button
            className="moovu-confirm-button"
            onClick={() => void submitBooking()}
            disabled={busy || !canSubmit}
          >
            {busy
              ? rideType === "scheduled" ? "Scheduling\u2026" : "Booking\u2026"
              : rideType === "scheduled" ? "Schedule ride" : "Confirm ride"}
          </button>
        </div>
      </section>
    </main>
  );
}
