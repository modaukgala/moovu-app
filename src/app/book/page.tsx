"use client";

import { type ClipboardEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import EnableNotificationsButton from "@/components/EnableNotificationsButton";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import {
  DEFAULT_RIDE_OPTION_ID,
  MAX_TRIP_STOPS,
  RIDE_OPTIONS,
  SURGE_MODES,
  calculateAddStopIncrease,
  calculateTripFare,
  type RideOptionId,
  type SurgeModeConfig,
} from "@/lib/domain/fare";
import { bestReverseGeocodeLabel, parsePastedLocation, type ReverseGeocodeResult } from "@/lib/locationPaste";
import { MOOVU_LEGAL_VERSION } from "@/lib/legal";
import { gpsMarkerIcon, stopMarkerIcon } from "@/lib/maps/liveMapMarkers";
import { getMoovuCurrentPosition } from "@/lib/native-permissions";
import { supabaseClient } from "@/lib/supabase/client";

type CustomerMe = {
  ok: boolean;
  customer?: { id: string; first_name: string; last_name: string; phone: string };
  legalAcceptance?: { accepted: boolean };
  error?: string;
};

type Prediction = { description: string; place_id: string };
type LocationKind = "pickup" | "dropoff";
type PasteTarget = LocationKind | "stop";
type ResolvedLocation = { address: string; placeId: string; lat: number; lng: number };
type PendingPastedLocation = {
  target: PasteTarget;
  stopIndex?: number;
  source: string;
  resolved: ResolvedLocation;
};
type StopInput = Omit<ResolvedLocation, "lat" | "lng"> & {
  lat: number | null;
  lng: number | null;
  predictions: Prediction[];
  loading: boolean;
  resolving: boolean;
  open: boolean;
  error: string | null;
};

const DEFAULT_CENTER = { lat: -26.188, lng: 28.3206 };
const FAVORITE_PLACE_SHORTCUTS = [
  { label: "Home", detail: "Save your usual pickup" },
  { label: "Work", detail: "Fast weekday trips" },
  { label: "School", detail: "Daily local routes" },
  { label: "Add Favourite", detail: "Coming soon" },
] as const;

// Bottom-sheet snap positions (% of viewport height the sheet top sits at)
const SNAP_COLLAPSED = 66;
const SNAP_EXPANDED = 48;

function money(v: number | null | undefined) {
  return v == null ? "R--" : `R${Math.round(Number(v))}`;
}
function fmtDist(v: number | null) { return v == null ? "--" : `${v} km`; }
function fmtDur(v: number | null)  { return v == null ? "--" : `${v} min`; }

function blankStop(): StopInput {
  return {
    address: "",
    placeId: "",
    lat: null,
    lng: null,
    predictions: [],
    loading: false,
    resolving: false,
    open: false,
    error: null,
  };
}

function selectedPlaceLabel(description: string, detailName?: unknown) {
  const name = typeof detailName === "string" ? detailName.trim() : "";
  if (name && !/^south africa$/i.test(name)) return name;
  const [firstPart] = description.split(",");
  return firstPart?.trim() || description;
}

function isResolvedStop(stop: StopInput): stop is StopInput & { address: string; lat: number; lng: number } {
  return !!stop.address.trim() && typeof stop.lat === "number" && typeof stop.lng === "number";
}

export default function RiderBookingPage() {
  const router = useRouter();

  const [customer, setCustomer] = useState<CustomerMe["customer"] | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [legalAcceptanceRequired, setLegalAcceptanceRequired] = useState(false);
  const [legalAccepting, setLegalAccepting] = useState(false);

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

  const [pickupError, setPickupError] = useState<string | null>(null);
  const [dropoffError, setDropoffError] = useState<string | null>(null);
  const [pickupResolving, setPickupResolving] = useState(false);
  const [dropoffResolving, setDropoffResolving] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [rideType, setRideType] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const [selectedRideOption, setSelectedRideOption] = useState<RideOptionId>(DEFAULT_RIDE_OPTION_ID);
  const [activeSurge, setActiveSurge] = useState<SurgeModeConfig>(SURGE_MODES.normal);

  const [busy, setBusy] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [originalDistanceKm, setOriginalDistanceKm] = useState<number | null>(null);
  const [originalDurationMin, setOriginalDurationMin] = useState<number | null>(null);
  const [baseFare, setBaseFare] = useState<number | null>(null);
  const [addStopIncrease, setAddStopIncrease] = useState(0);
  const [stops, setStops] = useState<StopInput[]>([]);
  const [stopsOpen, setStopsOpen] = useState(false);
  const [routeCalculationError, setRouteCalculationError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [routeVisible, setRouteVisible] = useState(false);
  const [pendingPastedLocation, setPendingPastedLocation] = useState<PendingPastedLocation | null>(null);
  const [pasteResolving, setPasteResolving] = useState(false);

  // ── Bottom sheet drag state ──────────────────────────────────────
  const [sheetSnap, setSheetSnap] = useState<"collapsed" | "expanded">("expanded");
  const [dragY, setDragY] = useState<number | null>(null); // live drag offset in px
  const dragStartYRef = useRef<number>(0);
  const dragStartSnapRef = useRef<"collapsed" | "expanded">("collapsed");
  const isDraggingRef = useRef(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const pickupBoxRef = useRef<HTMLDivElement | null>(null);
  const dropoffBoxRef = useRef<HTMLDivElement | null>(null);
  const pickupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimerRefs = useRef<Array<ReturnType<typeof setTimeout> | null>>([]);
  const lastCalculatedKeyRef = useRef("");
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const stopMarkerRefs = useRef<google.maps.Marker[]>([]);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  const bothLocationsSet = pickupLat != null && pickupLng != null && dropoffLat != null && dropoffLng != null;
  const resolvedStops = useMemo(() => stops.filter(isResolvedStop), [stops]);
  const stopCount = resolvedStops.length;
  const addStopBreakdown = useMemo(() => {
    if (
      stopCount === 0 ||
      originalDistanceKm == null ||
      originalDurationMin == null ||
      distanceKm == null ||
      durationMin == null
    ) {
      return null;
    }

    return calculateAddStopIncrease({
      rideOptionId: selectedRideOption,
      originalDistanceKm,
      originalDurationMin,
      routeDistanceKm: distanceKm,
      routeDurationMin: durationMin,
      stopCount,
    });
  }, [distanceKm, durationMin, originalDistanceKm, originalDurationMin, selectedRideOption, stopCount]);

  const originalFare = useMemo(() => {
    if (originalDistanceKm == null || originalDurationMin == null) return null;
    return calculateTripFare({
      distanceKm: originalDistanceKm,
      durationMin: originalDurationMin,
      rideOptionId: selectedRideOption,
      surgeLabel: activeSurge.mode,
      surgeMultiplier: activeSurge.multiplier,
    }).totalFare;
  }, [activeSurge.mode, activeSurge.multiplier, originalDistanceKm, originalDurationMin, selectedRideOption]);

  const fare = useMemo(() => {
    if (originalFare == null) return null;
    return Math.round(originalFare + (addStopBreakdown?.finalAddStopIncrease ?? 0));
  }, [addStopBreakdown?.finalAddStopIncrease, originalFare]);
  const displayFare = useMemo(() => {
    if (fare != null) return fare;
    if (baseFare != null) return Math.round(baseFare + addStopIncrease);
    return null;
  }, [addStopIncrease, baseFare, fare]);

  const canCalculate = useMemo(() => (
    !!pickupAddress.trim() && !!dropoffAddress.trim() &&
    pickupLat != null && pickupLng != null && dropoffLat != null && dropoffLng != null
  ), [pickupAddress, dropoffAddress, pickupLat, pickupLng, dropoffLat, dropoffLng]);

  const routeKey = useMemo(() => {
    if (!canCalculate) return "";
    const stopKey = resolvedStops
      .map((stop) => [stop.address.trim(), stop.placeId, stop.lat, stop.lng].join(":"))
      .join("|");
    return [pickupAddress.trim(), dropoffAddress.trim(), pickupLat, pickupLng, dropoffLat, dropoffLng, stopKey].join("|");
  }, [canCalculate, dropoffAddress, dropoffLat, dropoffLng, pickupAddress, pickupLat, pickupLng, resolvedStops]);

  const canSubmit = useMemo(() => (
    !!customer && canCalculate && distanceKm != null && durationMin != null && displayFare != null &&
    !legalAcceptanceRequired && !(rideType === "scheduled" && !scheduledFor)
  ), [customer, canCalculate, distanceKm, durationMin, displayFare, legalAcceptanceRequired, rideType, scheduledFor]);

  const loyaltyTitle = useMemo(() => {
    const name = customer?.first_name?.trim();
    return name ? `${name}, your MOOVU profile is ready` : "Your MOOVU profile is ready";
  }, [customer?.first_name]);

  const progressText = useMemo(() => {
    if (!pickupAddress.trim()) return "Set your pickup point";
    if (!dropoffAddress.trim()) return "Add your destination";
    if (!canCalculate) return "Resolving your locations...";
    if (displayFare == null) return "We are calculating this trip...";
    return routeVisible ? "Route ready - choose your ride" : "Trip details ready";
  }, [canCalculate, displayFare, dropoffAddress, pickupAddress, routeVisible]);

  const bookingStep = useMemo(() => {
    if (!pickupAddress.trim()) return 1;
    if (!dropoffAddress.trim() || !canCalculate) return 2;
    if (displayFare == null) return 3;
    return 4;
  }, [canCalculate, displayFare, dropoffAddress, pickupAddress]);

  const bookingSteps = useMemo(
    () => [
      { label: "Pickup", active: bookingStep >= 1 },
      { label: "Destination", active: bookingStep >= 2 },
      { label: "Ride type", active: bookingStep >= 3 },
      { label: "Confirm", active: bookingStep >= 4 },
      { label: "Track", active: false },
    ],
    [bookingStep],
  );

  // ── Sheet snap position in % of window height ───────────────────
  const sheetTopPct = sheetSnap === "collapsed" ? SNAP_COLLAPSED : SNAP_EXPANDED;

  // Live top px while dragging
  const sheetTopPx = useMemo(() => {
    if (typeof window === "undefined") return `${sheetTopPct}dvh`;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const basePx = (sheetTopPct / 100) * viewportHeight;
    return dragY != null ? `${basePx + dragY}px` : `${basePx}px`;
  }, [sheetTopPct, dragY]);

  // ── Drag handlers ────────────────────────────────────────────────
  function onDragStart(clientY: number) {
    isDraggingRef.current = true;
    dragStartYRef.current = clientY;
    dragStartSnapRef.current = sheetSnap;
    setDragY(0);
  }

  function onDragMove(clientY: number) {
    if (!isDraggingRef.current) return;
    setDragY(clientY - dragStartYRef.current);
  }

  function onDragEnd(clientY: number) {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const delta = clientY - dragStartYRef.current;
    setDragY(null);

    // Swipe up (negative delta) → expand; swipe down → collapse
    if (delta < -40) {
      setSheetSnap("expanded");
    } else if (delta > 40) {
      setSheetSnap("collapsed");
    }
    // else snap back to current
  }

  // Auto-expand when both locations set and fare calculated
  useEffect(() => {
    if (bothLocationsSet && displayFare != null) {
      setSheetSnap("expanded");
    }
  }, [bothLocationsSet, displayFare]);

  // ── Auth ─────────────────────────────────────────────────────────
  async function getAccessToken() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session?.access_token || "";
  }

  async function loadCustomer() {
    setAuthLoading(true);
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { router.replace("/customer/auth?next=/book"); return; }

    const res = await fetch("/api/customer/me", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = (await res.json()) as CustomerMe;
    if (!json?.ok || !json.customer) { router.replace("/customer/auth?next=/book"); return; }

    setCustomer(json.customer);
    setLegalAcceptanceRequired(!json.legalAcceptance?.accepted);
    setAuthLoading(false);
  }

  async function loadActiveSurge() {
    const res = await fetch(`/api/pricing/surge?ts=${Date.now()}`, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; surge?: SurgeModeConfig }
      | null;

    if (json?.ok && json.surge) {
      setActiveSurge(json.surge);
    }
  }

  async function acceptLegalTerms() {
    setLegalAccepting(true);
    setMsg(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) { router.replace("/customer/auth?next=/book"); return; }

      const res = await fetch("/api/customer/legal-acceptance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          acceptedTerms: true,
          acceptedPrivacy: true,
          termsVersion: MOOVU_LEGAL_VERSION,
          privacyVersion: MOOVU_LEGAL_VERSION,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setMsg(json?.error || "Could not save legal acceptance.");
        return;
      }

      setLegalAcceptanceRequired(false);
    } catch (error: unknown) {
      setMsg(error instanceof Error ? error.message : "Could not save legal acceptance.");
    } finally {
      setLegalAccepting(false);
    }
  }

  async function logout() {
    await supabaseClient.auth.signOut();
    router.push("/customer/auth");
  }

  // ── Location helpers ─────────────────────────────────────────────
  function resetRouteState() {
    setDistanceKm(null); setDurationMin(null); setOriginalDistanceKm(null); setOriginalDurationMin(null); setBaseFare(null); setAddStopIncrease(0); setRouteCalculationError(null);
    setRouteVisible(false); lastCalculatedKeyRef.current = "";
  }

  function clearPickupSelection() {
    setPickupPlaceId(""); setPickupLat(null); setPickupLng(null);
    setPickupError(null); resetRouteState();
  }

  function clearDropoffSelection() {
    setDropoffPlaceId(""); setDropoffLat(null); setDropoffLng(null);
    setDropoffError(null); resetRouteState();
  }

  async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
    const res = await fetch("/api/maps/reverse-geocode", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    });
    return res.json().catch(() => null);
  }

  function getLocationErrorMessage(error: GeolocationPositionError) {
    if (error.code === error.PERMISSION_DENIED)
      return "Location permission is blocked. Allow location access for MOOVU in your browser or app settings.";
    if (error.code === error.POSITION_UNAVAILABLE)
      return "MOOVU could not detect your GPS position. Enable location services or type your pickup.";
    if (error.code === error.TIMEOUT)
      return "Location detection timed out. Try again or type your pickup address.";
    return "MOOVU could not detect your location. Type your pickup or try again.";
  }

  function isGeolocationPositionError(e: unknown): e is GeolocationPositionError {
    return typeof e === "object" && e !== null && "code" in e && typeof (e as { code?: unknown }).code === "number";
  }

  async function resolveTypedLocation(kind: LocationKind, text: string): Promise<ResolvedLocation | null> {
    const input = text.trim();
    if (!input) return null;

    if (kind === "pickup" && pickupLat != null && pickupLng != null)
      return { address: pickupAddress.trim(), placeId: pickupPlaceId, lat: pickupLat, lng: pickupLng };
    if (kind === "dropoff" && dropoffLat != null && dropoffLng != null)
      return { address: dropoffAddress.trim(), placeId: dropoffPlaceId, lat: dropoffLat, lng: dropoffLng };

    if (kind === "pickup") { setPickupResolving(true); setPickupError(null); }
    else { setDropoffResolving(true); setDropoffError(null); }

    if (kind === "pickup") { if (pickupTimerRef.current) clearTimeout(pickupTimerRef.current); setPickupPredictions([]); setShowPickupDropdown(false); }
    else { if (dropoffTimerRef.current) clearTimeout(dropoffTimerRef.current); setDropoffPredictions([]); setShowDropoffDropdown(false); }

    try {
      const acRes = await fetch("/api/maps/autocomplete", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }),
      });
      const acJson = await acRes.json().catch(() => null);

      if (acJson?.ok && acJson.predictions?.length > 0) {
        const first = acJson.predictions[0] as Prediction;
        const detailRes = await fetch("/api/maps/place-details", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ place_id: first.place_id }),
        });
        const detail = await detailRes.json().catch(() => null);

        if (detail?.ok && typeof detail.lat === "number" && typeof detail.lng === "number") {
          const resolved = { address: selectedPlaceLabel(first.description, detail.name), placeId: detail.place_id || first.place_id, lat: detail.lat, lng: detail.lng };
          if (kind === "pickup") { setPickupAddress(resolved.address); setPickupPlaceId(resolved.placeId); setPickupLat(detail.lat); setPickupLng(detail.lng); setPickupPredictions([]); setShowPickupDropdown(false); }
          else { setDropoffAddress(resolved.address); setDropoffPlaceId(resolved.placeId); setDropoffLat(detail.lat); setDropoffLng(detail.lng); setDropoffPredictions([]); setShowDropoffDropdown(false); }
          resetRouteState();
          return resolved;
        }
      }

      const geoRes = await fetch("/api/maps/geocode", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ place: input }),
      });
      const geo = await geoRes.json().catch(() => null);

      if (geo?.ok && typeof geo.lat === "number" && typeof geo.lng === "number") {
        const resolved = { address: input, placeId: "", lat: geo.lat, lng: geo.lng };
        if (kind === "pickup") { setPickupAddress(resolved.address); setPickupPlaceId(""); setPickupLat(geo.lat); setPickupLng(geo.lng); setPickupPredictions([]); setShowPickupDropdown(false); }
        else { setDropoffAddress(resolved.address); setDropoffPlaceId(""); setDropoffLat(geo.lat); setDropoffLng(geo.lng); setDropoffPredictions([]); setShowDropoffDropdown(false); }
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
    setMsg(null); setPickupError(null);
    if (typeof window === "undefined") { setMsg("This device does not support location."); return; }
    setLocationLoading(true);

    try {
      const pos = await getMoovuCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setPickupLat(lat); setPickupLng(lng); setPickupPlaceId("");
      setPickupPredictions([]); setShowPickupDropdown(false); setPickupError(null);
      resetRouteState();

      const json = await reverseGeocode(lat, lng).catch(() => null);
      setPickupAddress(json?.ok && json.address ? json.address : `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } catch (e) {
      const msg = isGeolocationPositionError(e) ? getLocationErrorMessage(e) : "Could not detect location.";
      setPickupError(msg); setMsg(msg);
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
      const res = await fetch("/api/maps/autocomplete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) });
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
    setPickupAddress(value); clearPickupSelection();
    if (pickupTimerRef.current) clearTimeout(pickupTimerRef.current);
    pickupTimerRef.current = setTimeout(() => { void fetchPredictions("pickup", value); }, 250);
  }

  function onDropoffInputChange(value: string) {
    setDropoffAddress(value); clearDropoffSelection();
    if (dropoffTimerRef.current) clearTimeout(dropoffTimerRef.current);
    dropoffTimerRef.current = setTimeout(() => { void fetchPredictions("dropoff", value); }, 250);
  }

  function addStopField() {
    if (stops.length >= MAX_TRIP_STOPS) {
      setMsg("You can add up to 2 stops per trip.");
      return;
    }
    setStopsOpen(true);
    setStops((current) => [...current, blankStop()]);
    resetRouteState();
  }

  function removeStop(index: number) {
    setStops((current) => {
      const nextStops = current.filter((_, i) => i !== index);
      if (nextStops.length === 0) setStopsOpen(false);
      return nextStops;
    });
    resetRouteState();
  }

  function updateStop(index: number, patch: Partial<StopInput>) {
    setStops((current) =>
      current.map((stop, i) => (i === index ? { ...stop, ...patch } : stop))
    );
  }

  async function fetchStopPredictions(index: number, input: string) {
    if (input.trim().length < 3) {
      updateStop(index, { predictions: [], open: false, loading: false });
      return;
    }

    updateStop(index, { loading: true });
    try {
      const res = await fetch("/api/maps/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const json = await res.json().catch(() => null);
      const predictions = json?.ok ? ((json.predictions ?? []) as Prediction[]) : [];
      updateStop(index, { predictions, open: predictions.length > 0 });
    } finally {
      updateStop(index, { loading: false });
    }
  }

  function onStopInputChange(index: number, value: string) {
    updateStop(index, {
      address: value,
      placeId: "",
      lat: null,
      lng: null,
      error: null,
    });
    resetRouteState();

    if (stopTimerRefs.current[index]) clearTimeout(stopTimerRefs.current[index]!);
    stopTimerRefs.current[index] = setTimeout(() => {
      void fetchStopPredictions(index, value);
    }, 250);
  }

  function samePoint(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    return Math.abs(a.lat - b.lat) < 0.00008 && Math.abs(a.lng - b.lng) < 0.00008;
  }

  function validateStopLocation(index: number, location: ResolvedLocation) {
    if (pickupLat != null && pickupLng != null && samePoint(location, { lat: pickupLat, lng: pickupLng })) {
      return "Stop cannot be the same as pickup.";
    }
    if (dropoffLat != null && dropoffLng != null && samePoint(location, { lat: dropoffLat, lng: dropoffLng })) {
      return "Stop cannot be the same as final destination.";
    }
    const duplicate = stops.some((stop, i) =>
      i !== index &&
      typeof stop.lat === "number" &&
      typeof stop.lng === "number" &&
      samePoint(location, { lat: stop.lat, lng: stop.lng })
    );
    if (duplicate) return "Duplicate stops are not allowed.";
    return null;
  }

  async function resolveStop(index: number): Promise<ResolvedLocation | null> {
    const stop = stops[index];
    if (!stop) return null;
    const input = stop.address.trim();
    if (!input) return null;
    if (typeof stop.lat === "number" && typeof stop.lng === "number") {
      return { address: input, placeId: stop.placeId, lat: stop.lat, lng: stop.lng };
    }

    updateStop(index, { resolving: true, error: null, predictions: [], open: false });
    try {
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
            address: selectedPlaceLabel(first.description, detail.name),
            placeId: detail.place_id || first.place_id,
            lat: detail.lat,
            lng: detail.lng,
          };
          const validationError = validateStopLocation(index, resolved);
          if (validationError) {
            updateStop(index, { error: validationError });
            return null;
          }
          updateStop(index, { ...resolved, error: null });
          resetRouteState();
          return resolved;
        }
      }

      const geoRes = await fetch("/api/maps/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place: input }),
      });
      const geo = await geoRes.json().catch(() => null);

      if (geo?.ok && typeof geo.lat === "number" && typeof geo.lng === "number") {
        const resolved = { address: input, placeId: "", lat: geo.lat, lng: geo.lng };
        const validationError = validateStopLocation(index, resolved);
        if (validationError) {
          updateStop(index, { error: validationError });
          return null;
        }
        updateStop(index, { ...resolved, error: null });
        resetRouteState();
        return resolved;
      }

      updateStop(index, { error: "Please choose a valid stop location." });
      return null;
    } finally {
      updateStop(index, { resolving: false });
    }
  }

  async function chooseStopPlace(index: number, placeId: string, description: string) {
    const res = await fetch("/api/maps/place-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place_id: placeId }),
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok || typeof json.lat !== "number" || typeof json.lng !== "number") {
      updateStop(index, { error: json?.error || "Failed to load stop details." });
      return;
    }

    const resolved = {
      address: selectedPlaceLabel(description, json.name),
      placeId: json.place_id || placeId,
      lat: json.lat,
      lng: json.lng,
    };
    const validationError = validateStopLocation(index, resolved);
    if (validationError) {
      updateStop(index, { error: validationError, open: false });
      return;
    }

    updateStop(index, {
      ...resolved,
      predictions: [],
      open: false,
      error: null,
    });
    resetRouteState();
  }

  async function onPickupBlur() {
    setShowPickupDropdown(false);
    if (pickupAddress.trim() && pickupLat == null) await resolveTypedLocation("pickup", pickupAddress);
  }

  async function onDropoffBlur() {
    setShowDropoffDropdown(false);
    if (dropoffAddress.trim() && dropoffLat == null) await resolveTypedLocation("dropoff", dropoffAddress);
  }

  async function choosePlace(kind: "pickup" | "dropoff", placeId: string, description: string) {
    setMsg(null);
    const res = await fetch("/api/maps/place-details", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ place_id: placeId }) });
    const json = await res.json().catch(() => null);
    if (!json?.ok) { setMsg(json?.error || "Failed to load place details."); return; }

    if (kind === "pickup") {
      setPickupAddress(selectedPlaceLabel(description, json.name)); setPickupPlaceId(json.place_id || placeId);
      setPickupLat(typeof json.lat === "number" ? json.lat : null); setPickupLng(typeof json.lng === "number" ? json.lng : null);
      setPickupPredictions([]); setShowPickupDropdown(false); setPickupError(null);
    } else {
      setDropoffAddress(selectedPlaceLabel(description, json.name)); setDropoffPlaceId(json.place_id || placeId);
      setDropoffLat(typeof json.lat === "number" ? json.lat : null); setDropoffLng(typeof json.lng === "number" ? json.lng : null);
      setDropoffPredictions([]); setShowDropoffDropdown(false); setDropoffError(null);
    }
    resetRouteState();
  }

  async function resolvePastedLocation(
    target: PasteTarget,
    rawValue: string,
    stopIndex?: number,
  ) {
    const source = rawValue.trim();
    if (!source) return;

    setMsg(null);
    setPasteResolving(true);

    try {
      const serverRes = await fetch("/api/resolve-map-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: source }),
      }).catch(() => null);
      const serverJson = await serverRes?.json().catch(() => null) as
        | {
            ok?: boolean;
            error?: string;
            location?: {
              label?: string;
              lat?: number;
              lng?: number;
              placeId?: string;
            };
          }
        | null;

      if (
        serverJson?.ok &&
        typeof serverJson.location?.lat === "number" &&
        typeof serverJson.location?.lng === "number"
      ) {
        setPendingPastedLocation({
          target,
          stopIndex,
          source,
          resolved: {
            address: serverJson.location.label || `${serverJson.location.lat.toFixed(5)}, ${serverJson.location.lng.toFixed(5)}`,
            placeId: serverJson.location.placeId || "",
            lat: serverJson.location.lat,
            lng: serverJson.location.lng,
          },
        });
        return;
      }

      const parsed = parsePastedLocation(source);

      if (parsed.kind === "coordinates") {
        const json = await reverseGeocode(parsed.lat, parsed.lng).catch(() => null);
        const resolved = {
          address: json?.ok ? bestReverseGeocodeLabel(json, source) : `${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`,
          placeId: json?.placeId || "",
          lat: parsed.lat,
          lng: parsed.lng,
        };
        setPendingPastedLocation({ target, stopIndex, source, resolved });
        return;
      }

      if (parsed.kind === "place_id") {
        const detailRes = await fetch("/api/maps/place-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place_id: parsed.placeId }),
        });
        const detail = await detailRes.json().catch(() => null);
        if (detail?.ok && typeof detail.lat === "number" && typeof detail.lng === "number") {
          setPendingPastedLocation({
            target,
            stopIndex,
            source,
            resolved: {
              address: selectedPlaceLabel(parsed.label || detail.formatted_address || source, detail.name),
              placeId: detail.place_id || parsed.placeId,
              lat: detail.lat,
              lng: detail.lng,
            },
          });
          return;
        }
      }

      if (parsed.kind === "plus_code") {
        const geoRes = await fetch("/api/maps/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place: parsed.plusCode }),
        });
        const geo = await geoRes.json().catch(() => null);
        if (geo?.ok && typeof geo.lat === "number" && typeof geo.lng === "number") {
          const reverse = await reverseGeocode(geo.lat, geo.lng).catch(() => null);
          setPendingPastedLocation({
            target,
            stopIndex,
            source,
            resolved: {
              address: reverse?.ok ? bestReverseGeocodeLabel(reverse, parsed.plusCode) : geo.address || parsed.plusCode,
              placeId: reverse?.placeId || "",
              lat: geo.lat,
              lng: geo.lng,
            },
          });
          return;
        }
      }

      const candidate = parsed.kind === "text" ? parsed.query : source;

      const acRes = await fetch("/api/maps/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: candidate }),
      });
      const acJson = await acRes.json().catch(() => null);
      const first = acJson?.ok && acJson.predictions?.length > 0
        ? (acJson.predictions[0] as Prediction)
        : null;

      if (first?.place_id) {
        const detailRes = await fetch("/api/maps/place-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place_id: first.place_id }),
        });
        const detail = await detailRes.json().catch(() => null);
        if (detail?.ok && typeof detail.lat === "number" && typeof detail.lng === "number") {
          setPendingPastedLocation({
            target,
            stopIndex,
            source,
            resolved: {
              address: selectedPlaceLabel(first.description, detail.name),
              placeId: detail.place_id || first.place_id,
              lat: detail.lat,
              lng: detail.lng,
            },
          });
          return;
        }
      }

      const geoRes = await fetch("/api/maps/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place: candidate }),
      });
      const geo = await geoRes.json().catch(() => null);

      if (geo?.ok && typeof geo.lat === "number" && typeof geo.lng === "number") {
        setPendingPastedLocation({
          target,
          stopIndex,
          source,
          resolved: {
            address: selectedPlaceLabel(geo.address || candidate, geo.name),
            placeId: "",
            lat: geo.lat,
            lng: geo.lng,
          },
        });
        return;
      }

      setMsg(
        serverJson?.error ||
          "We couldn't identify that location. Try pasting coordinates, a full Google Maps link, or a Plus Code.",
      );
    } finally {
      setPasteResolving(false);
    }
  }

  function handleLocationPaste(
    event: ClipboardEvent<HTMLInputElement>,
    target: PasteTarget,
    stopIndex?: number,
  ) {
    const text = event.clipboardData.getData("text");
    if (!text.trim()) return;
    event.preventDefault();
    void resolvePastedLocation(target, text, stopIndex);
  }

  function applyPastedLocation() {
    if (!pendingPastedLocation) return;
    const { target, stopIndex, resolved } = pendingPastedLocation;

    if (target === "pickup") {
      setPickupAddress(resolved.address);
      setPickupPlaceId(resolved.placeId);
      setPickupLat(resolved.lat);
      setPickupLng(resolved.lng);
      setPickupPredictions([]);
      setShowPickupDropdown(false);
      setPickupError(null);
    } else if (target === "dropoff") {
      setDropoffAddress(resolved.address);
      setDropoffPlaceId(resolved.placeId);
      setDropoffLat(resolved.lat);
      setDropoffLng(resolved.lng);
      setDropoffPredictions([]);
      setShowDropoffDropdown(false);
      setDropoffError(null);
    } else if (typeof stopIndex === "number") {
      const validationError = validateStopLocation(stopIndex, resolved);
      if (validationError) {
        updateStop(stopIndex, { error: validationError });
        setPendingPastedLocation(null);
        return;
      }
      updateStop(stopIndex, {
        ...resolved,
        predictions: [],
        open: false,
        error: null,
      });
    }

    setPendingPastedLocation(null);
    resetRouteState();
  }

  function currentResolvedLocation(kind: LocationKind): ResolvedLocation | null {
    if (kind === "pickup") {
      if (pickupLat == null || pickupLng == null) return null;
      return { address: pickupAddress.trim(), placeId: pickupPlaceId, lat: pickupLat, lng: pickupLng };
    }
    if (dropoffLat == null || dropoffLng == null) return null;
    return { address: dropoffAddress.trim(), placeId: dropoffPlaceId, lat: dropoffLat, lng: dropoffLng };
  }

  async function ensureResolvedRoute() {
    const pickup = currentResolvedLocation("pickup") ?? (await resolveTypedLocation("pickup", pickupAddress));
    const dropoff = currentResolvedLocation("dropoff") ?? (await resolveTypedLocation("dropoff", dropoffAddress));
    if (!pickup) { setPickupError("Please choose a valid pickup location."); return null; }
    if (!dropoff) { setDropoffError("Please choose a valid destination."); return null; }

    const routeStops: ResolvedLocation[] = [];
    for (let i = 0; i < stops.length; i += 1) {
      const stop = stops[i];
      if (!stop.address.trim()) continue;
      const resolvedStop = isResolvedStop(stop)
        ? { address: stop.address.trim(), placeId: stop.placeId, lat: stop.lat, lng: stop.lng }
        : await resolveStop(i);
      if (!resolvedStop) {
        updateStop(i, { error: stop.error || "Please choose a valid stop location." });
        return null;
      }
      const validationError = validateStopLocation(i, resolvedStop);
      if (validationError) {
        updateStop(i, { error: validationError });
        return null;
      }
      routeStops.push(resolvedStop);
    }

    if (routeStops.length > MAX_TRIP_STOPS) {
      setMsg("You can add up to 2 stops per trip.");
      return null;
    }

    return { pickup, dropoff, stops: routeStops };
  }

  async function calculateTrip(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (!silent) setMsg(null);
    setRouteCalculationError(null);
    if (!pickupAddress.trim() || !dropoffAddress.trim()) { if (!silent) setMsg("Pickup and destination are required."); return null; }

    const route = await ensureResolvedRoute();
    if (!route) { if (!silent) setMsg("Please choose valid pickup and destination locations."); return null; }

    const waypoints = route.stops.map((stop) =>
      stop.placeId
        ? { place_id: stop.placeId }
        : { lat: stop.lat, lng: stop.lng }
    );
    const payload = route.pickup.placeId && route.dropoff.placeId
      ? { origin_place_id: route.pickup.placeId, destination_place_id: route.dropoff.placeId, waypoints }
      : { origin_lat: route.pickup.lat, origin_lng: route.pickup.lng, destination_lat: route.dropoff.lat, destination_lng: route.dropoff.lng, waypoints };

    const res = await fetch("/api/maps/distance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      const message = json?.error || "We could not calculate this trip yet. Please check your pickup and destination.";
      setRouteCalculationError(message);
      if (!silent) setMsg(message);
      return null;
    }

    const km = Number(json.distanceKm ?? 0);
    const mins = Number(json.durationMin ?? 0);
    const originalKm = Number(json.originalDistanceKm ?? km);
    const originalMins = Number(json.originalDurationMin ?? mins);
    const est = calculateTripFare({
      distanceKm: originalKm,
      durationMin: originalMins,
      rideOptionId: selectedRideOption,
      surgeLabel: activeSurge.mode,
      surgeMultiplier: activeSurge.multiplier,
    });
    const stopBreakdown = calculateAddStopIncrease({
      rideOptionId: selectedRideOption,
      originalDistanceKm: originalKm,
      originalDurationMin: originalMins,
      routeDistanceKm: km,
      routeDurationMin: mins,
      stopCount: route.stops.length,
    });
    const roundedKm = Number(km.toFixed(2));
    const roundedMins = Math.ceil(mins);
    const roundedOriginalKm = Number(originalKm.toFixed(2));
    const roundedOriginalMins = Math.ceil(originalMins);
    setDistanceKm(roundedKm);
    setDurationMin(roundedMins);
    setOriginalDistanceKm(roundedOriginalKm);
    setOriginalDurationMin(roundedOriginalMins);
    setBaseFare(est.totalFare);
    setAddStopIncrease(stopBreakdown.finalAddStopIncrease);
    return {
      distanceKm: roundedKm,
      durationMin: roundedMins,
      originalDistanceKm: roundedOriginalKm,
      originalDurationMin: roundedOriginalMins,
      addStopIncrease: stopBreakdown.finalAddStopIncrease,
    };
  }

  async function submitBooking() {
    setMsg(null);
    if (!customer) { setMsg("Something went wrong while loading your account. Please sign in again."); return; }
    if (!pickupAddress.trim() || !dropoffAddress.trim()) { setMsg("Pickup and destination are required."); return; }

    const route = await ensureResolvedRoute();
    if (!route) { setMsg("We could not prepare this trip yet. Please check your pickup and destination."); return; }

    let bDistKm = distanceKm;
    let bDurMin = durationMin;
    let bOriginalDistKm = originalDistanceKm;
    let bOriginalDurMin = originalDurationMin;
    if (distanceKm == null || durationMin == null || originalDistanceKm == null || originalDurationMin == null) {
      const calc = await calculateTrip({ silent: true });
      if (!calc) { setMsg("Your trip is being prepared. Please try again in a moment."); return; }
      bDistKm = calc.distanceKm; bDurMin = calc.durationMin;
      bOriginalDistKm = calc.originalDistanceKm; bOriginalDurMin = calc.originalDurationMin;
    }

    if (rideType === "scheduled" && !scheduledFor) { setMsg("Please choose the scheduled pickup date and time."); return; }
    setBusy(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) { router.replace("/customer/auth?next=/book"); return; }

      const stopBreakdown = bDistKm != null && bDurMin != null && bOriginalDistKm != null && bOriginalDurMin != null
        ? calculateAddStopIncrease({
            rideOptionId: selectedRideOption,
            originalDistanceKm: bOriginalDistKm,
            originalDurationMin: bOriginalDurMin,
            routeDistanceKm: bDistKm,
            routeDurationMin: bDurMin,
            stopCount: route.stops.length,
          })
        : null;
      const finalFare = bOriginalDistKm != null && bOriginalDurMin != null
        ? Math.round(calculateTripFare({
            distanceKm: bOriginalDistKm,
            durationMin: bOriginalDurMin,
            rideOptionId: selectedRideOption,
            surgeLabel: activeSurge.mode,
            surgeMultiplier: activeSurge.multiplier,
          }).totalFare + (stopBreakdown?.finalAddStopIncrease ?? 0))
        : fare ?? baseFare ?? 0;
      const rideOptionLabel = RIDE_OPTIONS.find((o) => o.id === selectedRideOption)?.name ?? "MOOVU Go";

      const res = await fetch("/api/customer/book-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          pickupAddress: route.pickup.address || pickupAddress,
          dropoffAddress: route.dropoff.address || dropoffAddress,
          pickupLat: route.pickup.lat, pickupLng: route.pickup.lng,
          dropoffLat: route.dropoff.lat, dropoffLng: route.dropoff.lng,
          stops: route.stops,
          paymentMethod, distanceKm: bDistKm, durationMin: bDurMin,
          originalDistanceKm: bOriginalDistKm,
          originalDurationMin: bOriginalDurMin,
          rideType, rideOption: selectedRideOption,
          scheduledFor: rideType === "scheduled" ? scheduledFor : null,
          fare_amount: finalFare, notes: `Ride option: ${rideOptionLabel}`,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!json?.ok) { setMsg(json?.error || "Could not create trip."); setBusy(false); return; }
      const tripId = json?.tripId ?? json?.trip?.id;
      if (tripId) { window.location.href = `/ride/${tripId}`; return; }
      setMsg(rideType === "scheduled" ? `Ride scheduled. Fare: ${money(finalFare)}` : `Trip booked. Fare: ${money(finalFare)}`);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Could not create trip.");
    }
    setBusy(false);
  }

  // ── Map ──────────────────────────────────────────────────────────
  function clearMapVisuals() {
    directionsRendererRef.current?.setMap(null); directionsRendererRef.current = null;
    if (pickupMarkerRef.current) { pickupMarkerRef.current.setMap(null); pickupMarkerRef.current = null; }
    if (dropoffMarkerRef.current) { dropoffMarkerRef.current.setMap(null); dropoffMarkerRef.current = null; }
    stopMarkerRefs.current.forEach((marker) => marker.setMap(null));
    stopMarkerRefs.current = [];
  }

  function ensureMap() {
    if (!mapRef.current || !window.google?.maps) return false;
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
        center: DEFAULT_CENTER, zoom: 12, streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
        zoomControl: false, gestureHandling: "greedy",
      });
    }
    return true;
  }

  function renderPickupOnlyMap() {
    if (!ensureMap() || pickupLat == null || pickupLng == null) return;
    const map = mapInstanceRef.current!;
    clearMapVisuals(); setRouteVisible(false);
    const pickup = { lat: pickupLat, lng: pickupLng };
    pickupMarkerRef.current = new window.google.maps.Marker({
      map,
      position: pickup,
      title: "Your current pickup location",
      icon: gpsMarkerIcon(),
    });
    map.setCenter(pickup); map.setZoom(15);
  }

  function renderRouteMap() {
    if (!ensureMap() || pickupLat == null || pickupLng == null || dropoffLat == null || dropoffLng == null) return;
    const map = mapInstanceRef.current!;
    clearMapVisuals();
    pickupMarkerRef.current = new window.google.maps.Marker({
      map,
      position: { lat: pickupLat, lng: pickupLng },
      title: "Pickup",
      icon: stopMarkerIcon("P"),
    });
    dropoffMarkerRef.current = new window.google.maps.Marker({
      map,
      position: { lat: dropoffLat, lng: dropoffLng },
      title: "Destination",
      icon: stopMarkerIcon("D"),
    });
    resolvedStops.forEach((stop, index) => {
      stopMarkerRefs.current.push(new window.google.maps.Marker({
        map,
        position: { lat: stop.lat, lng: stop.lng },
        title: `Stop ${index + 1}`,
        icon: stopMarkerIcon(index === 0 ? "1" : "2"),
      }));
    });

    const svc = new window.google.maps.DirectionsService();
    const renderer = new window.google.maps.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: "#1F74C9", strokeOpacity: 0.95, strokeWeight: 6 },
    });
    renderer.setMap(map); directionsRendererRef.current = renderer;

    svc.route(
      {
        origin: { lat: pickupLat, lng: pickupLng },
        destination: { lat: dropoffLat, lng: dropoffLng },
        waypoints: resolvedStops.map((stop) => ({
          location: { lat: stop.lat, lng: stop.lng },
          stopover: true,
        })),
        optimizeWaypoints: false,
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK && result) {
          renderer.setDirections(result); setRouteVisible(true); return;
        }
        const bounds = new window.google.maps.LatLngBounds();
        bounds.extend({ lat: pickupLat, lng: pickupLng });
        resolvedStops.forEach((stop) => bounds.extend({ lat: stop.lat, lng: stop.lng }));
        bounds.extend({ lat: dropoffLat, lng: dropoffLng });
        map.fitBounds(bounds); setRouteVisible(false);
      }
    );
  }

  // ── Effects ──────────────────────────────────────────────────────
  useEffect(() => {
    loadCustomer();
    void loadActiveSurge().catch(() => {
      setActiveSurge(SURGE_MODES.normal);
    });
    const surgeTimer = window.setInterval(() => {
      void loadActiveSurge().catch(() => undefined);
    }, 15000);
    const handleFocus = () => {
      void loadActiveSurge().catch(() => undefined);
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (pickupBoxRef.current && !pickupBoxRef.current.contains(target)) setShowPickupDropdown(false);
      if (dropoffBoxRef.current && !dropoffBoxRef.current.contains(target)) setShowDropoffDropdown(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    const stopTimers = stopTimerRefs.current;
    return () => {
      window.clearInterval(surgeTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
      document.removeEventListener("mousedown", handleClickOutside);
      if (pickupTimerRef.current) clearTimeout(pickupTimerRef.current);
      if (dropoffTimerRef.current) clearTimeout(dropoffTimerRef.current);
      stopTimers.forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
    };
    // Keep this as a mount/auth setup effect; adding helpers here restarts auth and dropdown listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const updateKeyboardInset = () => {
      const viewport = window.visualViewport;
      if (!viewport) return;
      const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty("--moovu-keyboard-inset", `${Math.round(keyboardInset)}px`);
    };

    updateKeyboardInset();
    window.visualViewport.addEventListener("resize", updateKeyboardInset);
    window.visualViewport.addEventListener("scroll", updateKeyboardInset);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateKeyboardInset);
      window.visualViewport?.removeEventListener("scroll", updateKeyboardInset);
      document.documentElement.style.removeProperty("--moovu-keyboard-inset");
    };
  }, []);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) { setMapError("Google Maps API key is missing."); return; }
    if (window.google?.maps) { setMapReady(true); setMapError(null); return; }

    const existing = document.getElementById("google-maps-script-booking") as HTMLScriptElement | null;
    const onLoad = () => { setMapReady(true); setMapError(null); };
    const onErr = () => { setMapError("Google Maps failed to load."); };

    if (existing) { existing.addEventListener("load", onLoad); existing.addEventListener("error", onErr); return () => { existing.removeEventListener("load", onLoad); existing.removeEventListener("error", onErr); }; }

    const script = document.createElement("script");
    script.id = "google-maps-script-booking";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
    script.async = true; script.defer = true;
    script.addEventListener("load", onLoad); script.addEventListener("error", onErr);
    document.head.appendChild(script);
    return () => { script.removeEventListener("load", onLoad); script.removeEventListener("error", onErr); };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    if (!ensureMap()) return;
    if (pickupLat != null && pickupLng != null && dropoffLat != null && dropoffLng != null) { renderRouteMap(); return; }
    if (pickupLat != null && pickupLng != null) { renderPickupOnlyMap(); return; }
    clearMapVisuals(); setRouteVisible(false);
    if (mapInstanceRef.current) { mapInstanceRef.current.setCenter(DEFAULT_CENTER); mapInstanceRef.current.setZoom(11); }
    // Map render helpers read refs and latest coordinates; listing them recreates this effect unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pickupLat, pickupLng, dropoffLat, dropoffLng, resolvedStops]);

  useEffect(() => {
    if (!canCalculate || !routeKey) return;
    if (lastCalculatedKeyRef.current === routeKey) return;
    lastCalculatedKeyRef.current = routeKey;
    void calculateTrip({ silent: true });
    // routeKey already captures the coordinates and addresses that should trigger fare recalculation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCalculate, routeKey]);

  // ── Loading screen ───────────────────────────────────────────────
  if (authLoading) {
    return (
      <main className="mbk-loading">
        <Image src="/logo.png" alt="MOOVU" width={120} height={72} priority />
        <div className="mbk-loading-card">
          <div className="moovu-skeleton h-4 w-36" />
          <div className="moovu-skeleton h-10 w-full" />
        </div>
      </main>
    );
  }

  const selectedRide = RIDE_OPTIONS.find((option) => option.id === selectedRideOption) ?? RIDE_OPTIONS[0];

  // ── Expanded-only section (hidden when collapsed) ────────────────
  const expandedDetails = (
    <>
      <div className="moovu-booking-state-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.14em] text-[var(--moovu-primary)]">
              Guided booking
            </div>
            <div className="mt-1 text-sm font-black text-slate-950">
              {displayFare == null
                ? "Your trip is being prepared..."
                : "Choose your ride and confirm when ready."}
            </div>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
              MOOVU connects you with verified local drivers and keeps you updated after booking.
            </p>
          </div>
          <span className={displayFare == null ? "moovu-status-pill" : "moovu-status-pill-ready"}>
            {displayFare == null ? "Preparing" : "Ready"}
          </span>
        </div>
        <div className="moovu-booking-steps" aria-label="Booking progress">
          {bookingSteps.map((step, index) => (
            <span
              key={step.label}
              className={`moovu-booking-step${step.active ? " active" : ""}${index < bookingStep ? " complete" : ""}`}
            >
              <b>{index + 1}</b>
              <small>{step.label}</small>
            </span>
          ))}
        </div>
      </div>
      {/* Ride options — only shown after fare calculated */}
      <div className="customer-loyalty-strip mt-3">
        <div>
          <span>MOOVU Local Member</span>
          <strong>{loyaltyTitle}</strong>
        </div>
        <div>
          <span>Rewards</span>
          <strong>Future rewards coming soon</strong>
        </div>
      </div>

      {distanceKm != null && durationMin != null && (
        <div className="mbk-ride-options">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="moovu-field-label">Choose ride type</div>
              <div className="mt-1 text-xs font-semibold text-slate-500">
                Select the vehicle that fits your trip.
              </div>
            </div>
            <div className="text-xs font-semibold text-slate-500">
              {fmtDist(distanceKm)} · {fmtDur(durationMin)}
            </div>
          </div>
          <div className="customer-ride-option-list">
            {RIDE_OPTIONS.map((opt) => {
              const active = selectedRideOption === opt.id;
              const optionFare = Math.round(
                calculateTripFare({
                  distanceKm: originalDistanceKm ?? distanceKm,
                  durationMin: originalDurationMin ?? durationMin,
                  rideOptionId: opt.id,
                  surgeLabel: activeSurge.mode,
                  surgeMultiplier: activeSurge.multiplier,
                }).totalFare +
                  (stopCount > 0
                    ? calculateAddStopIncrease({
                        rideOptionId: opt.id,
                        originalDistanceKm: originalDistanceKm ?? distanceKm,
                        originalDurationMin: originalDurationMin ?? durationMin,
                        routeDistanceKm: distanceKm,
                        routeDurationMin: durationMin,
                        stopCount,
                      }).finalAddStopIncrease
                    : 0)
              );
              const description = opt.id === "group" ? "More space for groups" : "Everyday local trips";
              return (
                <button key={opt.id} type="button"
                  className={`moovu-ride-option-card text-left${active ? " active" : ""}`}
                  onClick={() => setSelectedRideOption(opt.id)} aria-pressed={active}
                >
                  {active && <span className="moovu-selected-check" aria-hidden="true">✓</span>}
                  <div className="grid gap-2">
                    <Image
                      src={opt.id === "group" ? "/icons/moovu-go-xl-clean.png" : "/icons/moovu-go-clean.png"}
                      alt={opt.name}
                      width={150}
                      height={150}
                      className="moovu-ride-vehicle-art"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-slate-950">{opt.name}</div>
                      <div className="moovu-ride-price">{money(optionFare)}</div>
                      <div className="mt-1 text-xs font-black text-slate-700">{opt.capacity}</div>
                      <div className="mt-0.5 text-[11px] font-semibold leading-4 text-slate-500">{description}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="moovu-mini-pill">From {money(opt.baseFare)}</span>
                    {active && <span className="moovu-mini-pill moovu-mini-pill-selected">Selected</span>}
                  </div>
                </button>
              );
            })}
          </div>
          {activeSurge.mode !== "normal" && (
            <div className="mt-3 rounded-2xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800">
              {activeSurge.message}
            </div>
          )}
        </div>
      )}

      {stopCount > 0 && (
        <div className="moovu-booking-addstop-card mt-4">
          <div className="text-sm font-black text-emerald-900">Add stop applied</div>
          <div className="mt-1 text-xs font-semibold text-emerald-800">
            Extra route cost discounted by 40%. First 3 minutes waiting at each stop are free.
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="moovu-fare-mini-card">
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">Original fare</div>
              <div className="mt-1 text-sm font-black text-slate-950">{money(originalFare)}</div>
            </div>
            <div className="moovu-fare-mini-card">
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">Add stop</div>
              <div className="mt-1 text-sm font-black text-slate-950">+{money(addStopBreakdown?.finalAddStopIncrease ?? addStopIncrease)}</div>
            </div>
            <div className="moovu-fare-mini-card is-total">
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">Total</div>
              <div className="mt-1 text-sm font-black text-[var(--moovu-primary)]">{money(displayFare)}</div>
            </div>
          </div>
        </div>
      )}

      {/* When + Payment */}
      <div className="mt-4 grid gap-3 grid-cols-2">
        <div className="moovu-control-card">
          <div className="moovu-field-label">When</div>
          <div className="moovu-segmented mt-2">
            <button type="button" className={rideType === "now" ? "moovu-segmented-active" : ""} onClick={() => setRideType("now")}>Ride now</button>
            <button type="button" className={rideType === "scheduled" ? "moovu-segmented-active" : ""} onClick={() => setRideType("scheduled")}>Schedule</button>
          </div>
        </div>
        <div className="moovu-control-card">
          <div className="moovu-field-label">Payment</div>
          <button type="button" className="mt-2 min-h-11 w-full rounded-2xl bg-slate-100 px-4 text-sm font-bold text-slate-950" onClick={() => setPaymentMethod("cash")}>
            {paymentMethod === "cash" ? "Cash" : paymentMethod}
          </button>
        </div>
      </div>

      {rideType === "scheduled" && (
        <div className="customer-schedule-card mt-3">
          <label className="moovu-field-label" htmlFor="scheduled-for">Scheduled pickup</label>
          <input id="scheduled-for" type="datetime-local" className="moovu-input mt-2" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
          <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">
            Schedule rides are released to nearby drivers before pickup time. Fare is confirmed securely when you submit.
          </p>
        </div>
      )}

      {distanceKm != null && durationMin != null && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="moovu-trip-metric"><span>Distance</span><strong>{fmtDist(distanceKm)}</strong></div>
          <div className="moovu-trip-metric"><span>Time</span><strong>{fmtDur(durationMin)}</strong></div>
          <div className="moovu-trip-metric moovu-trip-metric-primary"><span>Fare</span><strong>{money(displayFare)}</strong></div>
        </div>
      )}

      {/* Trip summary */}
      <div className="moovu-booking-summary-card mt-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Trip summary</div>
            <div className="mt-1 text-sm font-semibold text-slate-950">
              {pickupAddress || "Set pickup"} to {stopCount > 0 ? `${stopCount} stop${stopCount > 1 ? "s" : ""}, then ` : ""}{dropoffAddress || "set destination"}
            </div>
          </div>
          <div className={routeVisible ? "moovu-status-pill-ready" : "moovu-status-pill"}>
            {routeVisible ? "Route ready" : "Planning"}
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">Final fare is confirmed before booking.</div>
        {routeCalculationError && (
          <div className="mt-2 rounded-2xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
            {routeCalculationError}
          </div>
        )}
      </div>

      {/* Push notifications */}
      <div className="moovu-booking-summary-card mt-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-bold text-slate-950">Ride updates</div>
            <div className="mt-1 text-xs text-slate-600">Get driver accepted, arrived, started, and completed alerts.</div>
          </div>
          <EnableNotificationsButton role="customer" variant="inline" />
        </div>
      </div>
    </>
  );
  return (
    <main className="mbk-page">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
      {pendingPastedLocation && (
        <div className="customer-detail-overlay" onClick={() => setPendingPastedLocation(null)}>
          <section
            className="customer-detail-sheet max-w-md"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="customer-detail-handle" />
            <div className="moovu-section-title">Location Found</div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Use this {pendingPastedLocation.target === "dropoff" ? "destination" : pendingPastedLocation.target}?
            </h2>
            <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-sm font-semibold leading-6 text-blue-800">
              {pendingPastedLocation.resolved.address}
            </div>
            <div className="mt-2 text-xs font-semibold text-slate-500">
              {pendingPastedLocation.resolved.lat.toFixed(5)}, {pendingPastedLocation.resolved.lng.toFixed(5)}
            </div>
            <div className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-[var(--moovu-primary)]">
              Detected from pasted location
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button type="button" className="moovu-btn moovu-btn-primary" onClick={applyPastedLocation}>
                Use This Location
              </button>
              <button type="button" className="moovu-btn moovu-btn-secondary" onClick={() => setPendingPastedLocation(null)}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
      {pasteResolving && (
        <div className="fixed left-1/2 top-5 z-[10000] -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-black text-[var(--moovu-primary)] shadow-xl">
          Resolving pasted location...
        </div>
      )}
      {legalAcceptanceRequired && (
        <div className="legal-booking-gate" role="dialog" aria-modal="true" aria-label="MOOVU legal acceptance">
          <div className="legal-booking-card">
            <div className="moovu-kicker">Before booking</div>
            <h2>Accept MOOVU terms</h2>
            <p>
              Please accept the MOOVU Terms of Service and Privacy Policy once before continuing
              with ride booking.
            </p>
            <div className="legal-booking-links">
              <Link href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link>
              <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>
              <Link href="/contact" target="_blank" rel="noopener noreferrer">Contact</Link>
            </div>
            <button
              type="button"
              className="moovu-btn moovu-btn-primary w-full"
              disabled={legalAccepting}
              onClick={() => void acceptLegalTerms()}
            >
              {legalAccepting ? "Saving..." : "I agree and want to book"}
            </button>
          </div>
        </div>
      )}

      {/* Full-screen map behind everything */}
      <div className="mbk-map-layer">
        {mapError
          ? <div className="mbk-map-error">{mapError}</div>
          : <div ref={mapRef} className="mbk-map" />
        }
      </div>

      {/* Floating top header */}
      <header className="mbk-header">
        <div className="moovu-brand-lockup">
          <Image src="/logo.png" alt="MOOVU Kasi Rides" width={96} height={58} priority />
          <div>
            <div className="moovu-kicker">Kasi Rides</div>
            <div className="text-sm font-bold text-slate-950">Book a ride</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/contact" className="moovu-icon-link hidden sm:inline-flex">Help</Link>
          <Link href="/ride/history" className="moovu-icon-link">Trips</Link>
          <button className="moovu-icon-link" onClick={logout}>Logout</button>
        </div>
      </header>

      {/* ── Bottom sheet ── */}
      <div
        ref={sheetRef}
        className={`mbk-sheet${sheetSnap === "expanded" ? " mbk-sheet-expanded" : ""}`}
        style={{ top: sheetTopPx, transition: dragY != null ? "none" : "top 0.38s cubic-bezier(0.32,0.72,0,1)" }}
        aria-label="Ride booking"
      >
        {/* Drag handle */}
        <div
          className="mbk-handle-wrap"
          onMouseDown={(e) => onDragStart(e.clientY)}
          onTouchStart={(e) => onDragStart(e.touches[0].clientY)}
          onMouseMove={(e) => { if (isDraggingRef.current) onDragMove(e.clientY); }}
          onTouchMove={(e) => { if (isDraggingRef.current) onDragMove(e.touches[0].clientY); }}
          onMouseUp={(e) => onDragEnd(e.clientY)}
          onTouchEnd={(e) => onDragEnd(e.changedTouches[0].clientY)}
        >
          <div className="mbk-handle" />
        </div>

        {/* Scrollable inner content */}
        <div className="mbk-sheet-scroll">
          {/* Title row */}
          <div className="flex items-center justify-between gap-3 px-4 pb-2">
            <div>
              <div className="moovu-kicker">MOOVU Rider</div>
              <h1 className="text-xl font-black tracking-tight text-slate-950">Where to?</h1>
              <p className="mt-0.5 text-xs text-slate-500">{progressText}</p>
            </div>
            <div className="moovu-account-pill">
              <span className="moovu-account-dot" />
              <span>{customer?.first_name || "Rider"}</span>
            </div>
          </div>

          {/* Route inputs box */}
          <div className="customer-floating-route-card mx-4 rounded-[24px] border border-[var(--moovu-border)] bg-white p-3 shadow-sm">
            {/* PICKUP */}
            <div className="moovu-route-field" ref={pickupBoxRef}>
              <div className="moovu-route-marker-wrap">
                <span className="moovu-route-dot moovu-route-dot-pickup" />
                <span className="moovu-route-line" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="moovu-field-label" htmlFor="pickup-input">Pickup</label>
                  <button type="button" className="moovu-loc-inline-btn" onClick={useCurrentLocation}
                    disabled={busy || locationLoading} title="Use my current location">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="8" cy="8" r="3" fill="currentColor" />
                      <path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    <span>{locationLoading ? "Locating…" : "My location"}</span>
                  </button>
                </div>
                <input id="pickup-input" className="moovu-route-input" placeholder="Pickup location"
                  value={pickupAddress} onChange={(e) => onPickupInputChange(e.target.value)}
                  onPaste={(e) => handleLocationPaste(e, "pickup")}
                  onBlur={() => void onPickupBlur()}
                  onFocus={() => { if (pickupPredictions.length > 0) setShowPickupDropdown(true); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onPickupBlur(); } }} />
                {pickupLoading && <div className="moovu-field-hint">Searching…</div>}
                {pickupResolving && <div className="moovu-field-hint">Resolving…</div>}
                {pickupError && <div className="moovu-field-error">{pickupError}</div>}
                {showPickupDropdown && pickupPredictions.length > 0 && (
                  <div className="moovu-place-menu">
                    {pickupPredictions.map((item) => (
                      <button key={item.place_id} type="button" className="moovu-place-option"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          void choosePlace("pickup", item.place_id, item.description);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void choosePlace("pickup", item.place_id, item.description);
                          }
                        }}>
                        {item.description}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="border-y border-[#eef2f6] px-1 py-2">
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl bg-[#f6fafc] px-3 text-left text-sm font-black text-[var(--moovu-primary)] disabled:text-slate-400"
                disabled={stops.length >= MAX_TRIP_STOPS && !stopsOpen}
                onClick={() => {
                  if (stops.length === 0) addStopField();
                  else setStopsOpen((value) => !value);
                }}
              >
                <span>{stops.length > 0 ? `${stops.length} stop${stops.length > 1 ? "s" : ""} added` : "+ Add stop"}</span>
                <span className="text-xs font-semibold text-slate-500">
                  {stops.length >= MAX_TRIP_STOPS ? "Max 2" : "40% off extra route"}
                </span>
              </button>
            </div>

            {stopsOpen && stops.map((stop, index) => (
              <div className="moovu-route-field" key={`stop-${index}`}>
                <div className="moovu-route-marker-wrap">
                  <span className="moovu-route-dot bg-[var(--moovu-primary)] text-white">
                    {index + 1}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <label className="moovu-field-label" htmlFor={`stop-input-${index}`}>
                      Stop {index + 1}
                    </label>
                    <button
                      type="button"
                      className="text-xs font-black text-red-600"
                      onClick={() => removeStop(index)}
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    id={`stop-input-${index}`}
                    className="moovu-route-input"
                    placeholder="Add a stop"
                    value={stop.address}
                    onChange={(e) => onStopInputChange(index, e.target.value)}
                    onPaste={(e) => handleLocationPaste(e, "stop", index)}
                    onBlur={() => {
                      updateStop(index, { open: false });
                      if (stop.address.trim() && !isResolvedStop(stop)) void resolveStop(index);
                    }}
                    onFocus={() => {
                      if (stop.predictions.length > 0) updateStop(index, { open: true });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void resolveStop(index);
                      }
                    }}
                  />
                  {stop.loading && <div className="moovu-field-hint">Searching...</div>}
                  {stop.resolving && <div className="moovu-field-hint">Resolving...</div>}
                  {stop.error && <div className="moovu-field-error">{stop.error}</div>}
                  {stop.open && stop.predictions.length > 0 && (
                    <div className="moovu-place-menu">
                    {stop.predictions.map((item) => (
                      <button
                        key={item.place_id}
                        type="button"
                        className="moovu-place-option"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            void chooseStopPlace(index, item.place_id, item.description);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              void chooseStopPlace(index, item.place_id, item.description);
                            }
                          }}
                      >
                        {item.description}
                      </button>
                    ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* DESTINATION */}
            <div className="moovu-route-field" ref={dropoffBoxRef}>
              <div className="moovu-route-marker-wrap">
                <span className="moovu-route-dot moovu-route-dot-dropoff" />
              </div>
              <div className="min-w-0 flex-1">
                <label className="moovu-field-label" htmlFor="dropoff-input">Destination</label>
                <input id="dropoff-input" className="moovu-route-input" placeholder="Where are you going?"
                  value={dropoffAddress} onChange={(e) => onDropoffInputChange(e.target.value)}
                  onPaste={(e) => handleLocationPaste(e, "dropoff")}
                  onBlur={() => void onDropoffBlur()}
                  onFocus={() => { if (dropoffPredictions.length > 0) setShowDropoffDropdown(true); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onDropoffBlur(); } }} />
                {dropoffLoading && <div className="moovu-field-hint">Searching…</div>}
                {dropoffResolving && <div className="moovu-field-hint">Resolving…</div>}
                {dropoffError && <div className="moovu-field-error">{dropoffError}</div>}
                {showDropoffDropdown && dropoffPredictions.length > 0 && (
                  <div className="moovu-place-menu">
                    {dropoffPredictions.map((item) => (
                      <button key={item.place_id} type="button" className="moovu-place-option"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          void choosePlace("dropoff", item.place_id, item.description);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void choosePlace("dropoff", item.place_id, item.description);
                          }
                        }}>
                        {item.description}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mx-4 mt-3 customer-booking-favorites customer-booking-favorites-compact">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="moovu-field-label">Favourite places</div>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Quick places are being prepared for your account.
                </p>
              </div>
              <span className="moovu-mini-pill">Local shortcuts</span>
            </div>
            <div className="customer-favorite-grid mt-3">
              {FAVORITE_PLACE_SHORTCUTS.map((favorite) => (
                <button
                  key={favorite.label}
                  type="button"
                  className="customer-favorite-chip"
                  onClick={() => setMsg(`${favorite.label} favourite places are coming soon.`)}
                >
                  <strong>{favorite.label}</strong>
                  <span>{favorite.detail}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 pb-4">{expandedDetails}</div>
        </div>

        {/* ── Confirm bar — always visible at bottom of sheet ── */}
        <div className="mbk-confirm-bar">
          <div className="customer-booking-payment-strip">
            <div>
              <span>Cash</span>
              <strong>Personal trip</strong>
            </div>
            <small>{selectedRide.name}</small>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Estimated total</div>
            <div className="mbk-footer-fare">{displayFare == null ? "Set route" : money(displayFare)}</div>
          </div>
          <button
            className="moovu-confirm-button flex-1"
            onClick={() => void submitBooking()}
            disabled={busy || !canSubmit}
          >
            {busy
              ? rideType === "scheduled" ? "Scheduling…" : "Booking…"
              : rideType === "scheduled" ? `Schedule ${selectedRide.name}` : `Book ${selectedRide.name}`}
          </button>
        </div>
      </div>
    </main>
  );
}
