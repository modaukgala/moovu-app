"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import LoadingState from "@/components/ui/LoadingState";
import TripChatPanel from "@/components/trip-chat/TripChatPanel";
import { notifyInApp } from "@/lib/in-app-notifications";
import {
  carMarkerIcon,
  createOrMoveMarker,
  fitBoundsToPoints,
  makeRouteRenderer,
  stopMarkerIcon,
} from "@/lib/maps/liveMapMarkers";
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
  distance_km: number | null;
  duration_min: number | null;
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
  completed_at?: string | null;
  stops?: unknown;
  original_fare?: number | null;
  final_add_stop_increase?: number | null;
  final_fare?: number | null;
  stop_waiting_fee?: number | null;
  estimated_fare?: number | null;
  fare_adjustment_amount?: number | null;
  fare_adjustment_reason?: string | null;
  fare_finalized_at?: string | null;
};

type TripStop = {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
};

type Prediction = {
  description?: string;
  place_id?: string;
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

function displayDistance(value: number | null | undefined) {
  return value == null ? "--" : `${Number(value).toFixed(1)} km`;
}

function displayDuration(value: number | null | undefined) {
  return value == null ? "--" : `${Math.round(Number(value))} min`;
}

function selectedPlaceLabel(description: string | undefined, name: string | undefined) {
  const cleanName = (name ?? "").trim();
  if (cleanName) return cleanName;
  const cleanDescription = (description ?? "").trim();
  return cleanDescription.split(",")[0]?.trim() || cleanDescription;
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
  const searchParams = useSearchParams();
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;

  const [trip, setTrip] = useState<RideTrip | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [rating, setRating] = useState<Rating | null>(null);
  const [tracking, setTracking] = useState<Tracking | null>(null);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelReason, setCancelReason] =
    useState<(typeof CANCEL_REASONS)[number]>("Driver is taking too long");
  const [mapError, setMapError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showCompletionPrompt, setShowCompletionPrompt] = useState(false);
  const [addStopOpen, setAddStopOpen] = useState(false);
  const [addStopInput, setAddStopInput] = useState("");
  const [addStopPredictions, setAddStopPredictions] = useState<Prediction[]>([]);
  const [selectedAddStop, setSelectedAddStop] = useState<TripStop | null>(null);
  const [addStopNote, setAddStopNote] = useState("");
  const [addStopBusy, setAddStopBusy] = useState(false);
  const [addStopError, setAddStopError] = useState<string | null>(null);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const stopMarkerRefs = useRef<google.maps.Marker[]>([]);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const addStopTimerRef = useRef<number | null>(null);
  const previousTripSnapshotRef = useRef<{
    status: string | null;
    startOtpVerified: boolean;
    endOtpVerified: boolean;
  } | null>(null);

  const tripStops = useMemo<TripStop[]>(() => {
    if (!Array.isArray(trip?.stops)) return [];
    return trip.stops
      .slice(0, 2)
      .map((stop) => {
        const item = (stop ?? {}) as { address?: unknown; lat?: unknown; lng?: unknown; placeId?: unknown };
        return {
          address: typeof item.address === "string" ? item.address : "",
          lat: Number(item.lat),
          lng: Number(item.lng),
          placeId: typeof item.placeId === "string" ? item.placeId : undefined,
        };
      })
      .filter((stop) => stop.address.trim() && Number.isFinite(stop.lat) && Number.isFinite(stop.lng));
  }, [trip?.stops]);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token || "";
  }, []);

  const loadTrip = useCallback(async () => {
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
    setRating(json.rating ?? null);
    setTracking(json.tracking ?? null);
    setLoading(false);
  }, [getAccessToken, router, tripId]);

  const clearMapLayers = useCallback(() => {
    if (pickupMarkerRef.current) pickupMarkerRef.current.setMap(null);
    if (dropoffMarkerRef.current) dropoffMarkerRef.current.setMap(null);
    if (driverMarkerRef.current) driverMarkerRef.current.setMap(null);
    if (directionsRendererRef.current) directionsRendererRef.current.setMap(null);
    stopMarkerRefs.current.forEach((marker) => marker.setMap(null));

    pickupMarkerRef.current = null;
    dropoffMarkerRef.current = null;
    driverMarkerRef.current = null;
    directionsRendererRef.current = null;
    stopMarkerRefs.current = [];
  }, []);

  const initMapIfNeeded = useCallback(() => {
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
  }, []);

  const updateMap = useCallback(() => {
    if (!trip || !initMapIfNeeded()) return;

    const map = mapInstanceRef.current!;
    clearMapLayers();

    const points: google.maps.LatLngLiteral[] = [];

    if (trip.pickup_lat != null && trip.pickup_lng != null) {
      const pos = { lat: Number(trip.pickup_lat), lng: Number(trip.pickup_lng) };
      pickupMarkerRef.current = new window.google.maps.Marker({
        map,
        position: pos,
        title: "Pickup",
        icon: stopMarkerIcon("P"),
      });
      points.push(pos);
    }

    if (trip.dropoff_lat != null && trip.dropoff_lng != null) {
      const pos = { lat: Number(trip.dropoff_lat), lng: Number(trip.dropoff_lng) };
      dropoffMarkerRef.current = new window.google.maps.Marker({
        map,
        position: pos,
        title: "Dropoff",
        icon: stopMarkerIcon("D"),
      });
      points.push(pos);
    }

    tripStops.forEach((stop, index) => {
      const pos = { lat: stop.lat, lng: stop.lng };
      stopMarkerRefs.current.push(new window.google.maps.Marker({
        map,
        position: pos,
        title: `Stop ${index + 1}`,
        icon: stopMarkerIcon(index === 0 ? "1" : "2"),
      }));
      points.push(pos);
    });

    if (driver?.lat != null && driver?.lng != null) {
      const pos = { lat: Number(driver.lat), lng: Number(driver.lng) };
      driverMarkerRef.current = createOrMoveMarker({
        map,
        position: pos,
        title: "Driver",
        marker: driverMarkerRef.current,
        icon: carMarkerIcon(),
      });
      points.push(pos);
    }

    if (points.length > 0) {
      fitBoundsToPoints(map, points);
    } else {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(11);
    }

    const routeDestination =
      driver?.lat != null &&
      driver?.lng != null &&
      trip.pickup_lat != null &&
      trip.pickup_lng != null &&
      (trip.status === "assigned" || trip.status === "arrived")
        ? { lat: Number(trip.pickup_lat), lng: Number(trip.pickup_lng) }
        : driver?.lat != null &&
            driver?.lng != null &&
            trip.dropoff_lat != null &&
            trip.dropoff_lng != null &&
            trip.status === "ongoing"
          ? { lat: Number(trip.dropoff_lat), lng: Number(trip.dropoff_lng) }
          : null;

    if (driver?.lat != null && driver?.lng != null && routeDestination) {
      const directionsService = new window.google.maps.DirectionsService();
      const directionsRenderer = makeRouteRenderer(map);
      directionsRendererRef.current = directionsRenderer;

      directionsService.route(
        {
          origin: { lat: Number(driver.lat), lng: Number(driver.lng) },
          destination: routeDestination,
          waypoints:
            trip.status === "ongoing"
              ? tripStops.map((stop) => ({
                  location: { lat: stop.lat, lng: stop.lng },
                  stopover: true,
                }))
              : [],
          optimizeWaypoints: false,
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === "OK" && result) {
            directionsRenderer.setDirections(result);
          }
        }
      );
    }
  }, [clearMapLayers, driver, initMapIfNeeded, trip, tripStops]);

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
  }, [loadTrip]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!trip) return;

    const previous = previousTripSnapshotRef.current;
    const current = {
      status: trip.status,
      startOtpVerified: Boolean(trip.start_otp_verified),
      endOtpVerified: Boolean(trip.end_otp_verified),
    };

    previousTripSnapshotRef.current = current;
    if (!previous) return;

    if (previous.status !== trip.status) {
      if (trip.status === "assigned") {
        notifyInApp({
          title: "Driver accepted the trip",
          body: "Your MOOVU driver is on the way to pickup.",
          tone: "success",
          loud: true,
        });
      }

      if (trip.status === "arrived") {
        notifyInApp({
          title: "Driver arrived",
          body: "Share the start OTP only when you are ready to leave.",
          tone: "offer",
          loud: true,
        });
      }

      if (trip.status === "ongoing") {
        notifyInApp({
          title: "Trip started",
          body: "Start OTP verified. Your ride is now in progress.",
          tone: "success",
          loud: true,
        });
      }

      if (trip.status === "completed") {
        notifyInApp({
          title: "Trip completed",
          body: "End OTP verified. Your receipt is ready.",
          tone: "success",
          loud: true,
        });

        const promptKey = `moovu:completion-prompt:${trip.id}`;
        if (!rating && window.localStorage.getItem(promptKey) !== "1") {
          window.localStorage.setItem(promptKey, "1");
          window.setTimeout(() => setShowCompletionPrompt(true), 0);
        }
      }
    } else if (!previous.startOtpVerified && current.startOtpVerified) {
      notifyInApp({
        title: "Start OTP verified",
        body: "The trip has started securely.",
        tone: "success",
        loud: true,
      });
    } else if (!previous.endOtpVerified && current.endOtpVerified) {
      notifyInApp({
        title: "End OTP verified",
        body: "The trip has been completed securely.",
        tone: "success",
        loud: true,
      });
    }
  }, [rating, trip]);

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
  }, [updateMap]);

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

  async function fetchAddStopPredictions(input: string) {
    if (input.trim().length < 3) {
      setAddStopPredictions([]);
      return;
    }

    const res = await fetch("/api/maps/autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    const json = await res.json().catch(() => null);
    setAddStopPredictions(json?.ok ? ((json.predictions ?? []) as Prediction[]) : []);
  }

  function onAddStopInput(value: string) {
    setAddStopInput(value);
    setSelectedAddStop(null);
    setAddStopError(null);

    if (addStopTimerRef.current) window.clearTimeout(addStopTimerRef.current);
    addStopTimerRef.current = window.setTimeout(() => {
      void fetchAddStopPredictions(value);
    }, 220);
  }

  async function chooseAddStopPlace(placeId: string | undefined, description: string | undefined) {
    if (!placeId) return;

    setAddStopBusy(true);
    setAddStopError(null);

    try {
      const res = await fetch("/api/maps/place-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_id: placeId }),
      });
      const json = await res.json().catch(() => null);

      if (!json?.ok || typeof json.lat !== "number" || typeof json.lng !== "number") {
        setAddStopError(json?.error || "Could not load that stop. Please choose another place.");
        return;
      }

      const address = selectedPlaceLabel(description, json.name);
      setSelectedAddStop({
        address,
        placeId: json.place_id || placeId,
        lat: json.lat,
        lng: json.lng,
      });
      setAddStopInput(address);
      setAddStopPredictions([]);
    } finally {
      setAddStopBusy(false);
    }
  }

  async function submitActiveStop() {
    if (!trip || !selectedAddStop) {
      setAddStopError("Choose a stop from the list first.");
      return;
    }

    setAddStopBusy(true);
    setAddStopError(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        router.replace(`/customer/auth?next=/ride/${tripId}`);
        return;
      }

      const res = await fetch("/api/customer/trips/add-stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          tripId: trip.id,
          stop: selectedAddStop,
          note: addStopNote,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setAddStopError(json?.error || "Could not add this stop. Please try again.");
        return;
      }

      setTrip(json.trip ?? null);
      setMsg("Stop added. Your pending trip total has been updated.");
      setAddStopOpen(false);
      setAddStopInput("");
      setAddStopNote("");
      setSelectedAddStop(null);
      setAddStopPredictions([]);
      await loadTrip();
    } finally {
      setAddStopBusy(false);
    }
  }

  const canCancel = useMemo(() => {
    if (!trip) return false;
    return trip.status !== "completed" && trip.status !== "cancelled" && trip.status !== "ongoing";
  }, [trip]);

  const canAddStop = useMemo(() => {
    if (!trip) return false;
    return ["assigned", "arrived", "ongoing"].includes(trip.status) && tripStops.length < 2;
  }, [trip, tripStops.length]);

  const cancellationPreview = useMemo(() => {
    if (!trip) return { fee: 0, label: "Cancel ride for free" };
    const createdMs = trip.created_at ? new Date(trip.created_at).getTime() : NaN;
    const insideFreeWindow = Number.isFinite(createdMs) && nowMs - createdMs <= 2 * 60 * 1000;
    const fee = !insideFreeWindow && (trip.status === "assigned" || trip.status === "arrived") ? 15 : 0;
    return {
      fee,
      label: fee > 0 ? `Confirm cancellation fee R${fee}` : "Cancel ride for free",
    };
  }, [nowMs, trip]);

  const canShare = useMemo(() => {
    if (!trip) return false;
    return trip.status === "ongoing" && !!trip.start_otp_verified;
  }, [trip]);

  const canOpenChat = useMemo(() => {
    if (!trip?.driver_id) return false;
    return ["assigned", "arrived", "ongoing", "completed", "cancelled"].includes(trip.status);
  }, [trip]);

  const canShowDriverDetails = useMemo(() => {
    if (!driver || !trip) return false;
    return ["assigned", "arrived", "ongoing", "completed", "cancelled"].includes(trip.status);
  }, [driver, trip]);

  const carText = useMemo(() => {
    if (!driver) return "--";
    return [driver.vehicle_make, driver.vehicle_model, driver.vehicle_color]
      .filter(Boolean)
      .join(" - ") || "--";
  }, [driver]);

  const driverName = useMemo(() => {
    if (!driver) return "Searching...";
    return `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || "Assigned driver";
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

  const otpCards = useMemo(() => {
    if (!trip || trip.status === "completed" || trip.status === "cancelled") return [];

    if (!trip.start_otp_verified && ["assigned", "arrived"].includes(trip.status)) {
      return [
        {
          label: "Start OTP",
          value: trip.start_otp ?? "--",
          helper: "Share this with the driver only when you are ready to start.",
          tone: "primary",
        },
      ];
    }

    if (trip.status === "ongoing" && !trip.end_otp_verified) {
      return [
        {
          label: "End OTP",
          value: trip.end_otp ?? "--",
          helper: "Use this at the end of the trip if the driver requests it.",
          tone: "warning",
        },
      ];
    }

    return [
      {
        label: "OTP status",
        value: "Verified",
        helper: "Trip security checks are complete for the current step.",
        tone: "success",
      },
    ];
  }, [trip]);

  const tripTotalLabel = useMemo(() => {
    if (trip?.status === "completed") return "Final total";
    if (trip?.status === "cancelled") return "Trip total";
    return "Pending total";
  }, [trip?.status]);

  const displayTotal = useMemo(() => {
    if (!trip) return 0;
    return Number(trip.final_fare ?? trip.fare_amount ?? 0);
  }, [trip]);

  const routeAddition = useMemo(() => {
    if (!trip) return 0;
    return Number(trip.final_add_stop_increase ?? 0) + Number(trip.stop_waiting_fee ?? 0);
  }, [trip]);

  const fareHelperText = useMemo(() => {
    if (trip?.status === "completed") return "Receipt-ready total after trip completion.";
    if (trip?.status === "cancelled") return "Shown for reference after cancellation.";
    return "This total stays pending until the trip ends and the end OTP is verified.";
  }, [trip?.status]);

  const premiumTripStats = useMemo(() => {
    if (!trip) return [];

    return [
      {
        label: "Route distance",
        value: displayDistance(trip.distance_km),
        helper: "Based on the booked route",
      },
      {
        label: "Trip time",
        value: displayDuration(trip.duration_min),
        helper: "Estimated driving duration",
      },
      {
        label: "Stops",
        value: String(tripStops.length),
        helper: tripStops.length > 0 ? "Included in trip total" : "Direct ride",
      },
      {
        label: "Payment",
        value: displayValue(trip.payment_method),
        helper: "Settled through the selected method",
      },
    ];
  }, [trip, tripStops.length]);

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
      {addStopOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
          <section className="w-full max-w-lg rounded-[30px] border border-blue-100 bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.22)] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-blue-700">
                  Add stop
                </div>
                <h2 className="mt-4 text-2xl font-black text-slate-950">
                  Add a stop to this ride
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Choose a place from the list. MOOVU recalculates the route and applies the 40% add-stop discount before the trip is finalized.
                </p>
              </div>
              <button
                type="button"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-lg font-black text-slate-600"
                onClick={() => setAddStopOpen(false)}
                disabled={addStopBusy}
                aria-label="Close add stop"
              >
                x
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="relative">
                <label className="mb-2 block text-sm font-black text-slate-700">
                  Stop location
                </label>
                <input
                  className="moovu-input"
                  value={addStopInput}
                  onChange={(event) => onAddStopInput(event.target.value)}
                  onFocus={() => {
                    if (addStopPredictions.length > 0) setAddStopPredictions([...addStopPredictions]);
                  }}
                  placeholder="Search for mall, school, clinic, or area"
                  disabled={addStopBusy}
                />

                {addStopPredictions.length > 0 && (
                  <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[10000] max-h-64 overflow-y-auto rounded-[22px] border border-blue-100 bg-white p-2 shadow-[0_22px_60px_rgba(15,23,42,0.18)]">
                    {addStopPredictions.map((prediction) => (
                      <button
                        key={prediction.place_id || prediction.description}
                        type="button"
                        className="w-full rounded-2xl px-3 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-blue-50 active:bg-blue-100"
                        onClick={() => void chooseAddStopPlace(prediction.place_id, prediction.description)}
                      >
                        {prediction.description}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedAddStop && (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                  Selected stop: {selectedAddStop.address}
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-black text-slate-700">
                  Note for driver (optional)
                </label>
                <input
                  className="moovu-input"
                  value={addStopNote}
                  onChange={(event) => setAddStopNote(event.target.value)}
                  placeholder="Example: quick pickup at entrance"
                  maxLength={240}
                  disabled={addStopBusy}
                />
              </div>

              {addStopError && (
                <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">
                  {addStopError}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className="moovu-btn moovu-btn-primary w-full"
                  disabled={addStopBusy || !selectedAddStop}
                  onClick={() => void submitActiveStop()}
                >
                  {addStopBusy ? "Checking route..." : "Add stop and update fare"}
                </button>
                <button
                  type="button"
                  className="moovu-btn moovu-btn-secondary w-full"
                  disabled={addStopBusy}
                  onClick={() => setAddStopOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {showCompletionPrompt && trip.status === "completed" && !rating && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
          <section className="w-full max-w-md rounded-[30px] border border-emerald-100 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
            <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
              Trip completed
            </div>
            <h2 className="mt-4 text-2xl font-black text-slate-950">
              How was your MOOVU ride?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Your receipt is ready. You can rate the driver now or close this message and come back later.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Link
                href={`/ride/${trip.id}/rate`}
                className="moovu-btn moovu-btn-primary justify-center"
              >
                Rate trip
              </Link>
              <button
                type="button"
                className="moovu-btn moovu-btn-secondary"
                onClick={() => setShowCompletionPrompt(false)}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}

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

        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <section className="rounded-[24px] border border-blue-100 bg-[#eaf3ff] p-4 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-700">
              {tripTotalLabel}
            </div>
            <div className="mt-2 text-3xl font-black text-slate-950">{money(displayTotal)}</div>
            <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">{fareHelperText}</p>
          </section>

          {premiumTripStats.slice(0, 3).map((item) => (
            <section key={item.label} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                {item.label}
              </div>
              <div className="mt-2 text-2xl font-black text-slate-950">{item.value}</div>
              <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{item.helper}</p>
            </section>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <section className="relative min-h-[72vh] overflow-hidden rounded-[28px] border border-[var(--moovu-border)] bg-white shadow-sm">
            <div className="absolute left-4 top-4 z-10 rounded-full bg-white/95 px-4 py-2 text-sm font-medium text-slate-700 shadow">
              {tracking?.liveState || statusLabel(trip.status)}
            </div>

            {mapError ? (
              <div className="flex min-h-[72vh] items-center justify-center bg-slate-50 p-6 text-sm text-slate-700">
                {mapError}
              </div>
            ) : (
              <div ref={mapRef} className="min-h-[72vh] w-full bg-slate-100" />
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
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="moovu-stat-card">
                  <div className="moovu-stat-label">{tripTotalLabel}</div>
                  <div className="moovu-stat-value">{money(displayTotal)}</div>
                </div>

                <div className="moovu-stat-card">
                  <div className="moovu-stat-label">Payment</div>
                  <div className="moovu-stat-value capitalize">
                    {displayValue(trip.payment_method)}
                  </div>
                </div>

                <div className="moovu-stat-card">
                  <div className="moovu-stat-label">Distance</div>
                  <div className="moovu-stat-value">{displayDistance(trip.distance_km)}</div>
                </div>

                <div className="moovu-stat-card">
                  <div className="moovu-stat-label">Duration</div>
                  <div className="moovu-stat-value">{displayDuration(trip.duration_min)}</div>
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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-500">Driver</div>
                  <div className="mt-2 text-2xl font-black text-slate-950">
                    {canShowDriverDetails ? driverName : "Searching for driver"}
                  </div>
                </div>
                <div className={statusChipClass(trip.status)}>
                  <span className="moovu-chip-dot" />
                  {statusLabel(trip.status)}
                </div>
              </div>

              {!canShowDriverDetails ? (
                <div className="mt-4 rounded-2xl bg-[#eaf3ff] p-4 text-sm font-semibold text-[#244f9e]">
                  Driver details, vehicle, phone, and chat unlock after a driver accepts your trip.
                </div>
              ) : (
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
              )}

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

              {canShowDriverDetails && driver?.phone && (
                <a href={`tel:${driver.phone}`} className="moovu-btn moovu-btn-primary mt-4 w-full">
                  Call driver
                </a>
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

                {tripStops.map((stop, index) => (
                  <div key={`${stop.address}-${index}`}>
                    <div className="flex gap-3">
                      <div className="mt-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--moovu-primary)] text-[10px] font-black text-white">
                        {index + 1}
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Stop {index + 1}</div>
                        <div className="mt-1 text-sm font-medium text-slate-900">
                          {displayValue(stop.address)}
                        </div>
                      </div>
                    </div>
                    <div className="ml-[10px] h-8 w-0.5 bg-slate-200" />
                  </div>
                ))}

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

            {otpCards.length > 0 && (
              <section className="moovu-card p-5">
                <div className="text-sm font-medium text-slate-500">Ride security</div>

                <div className="mt-4 grid gap-3">
                  {otpCards.map((otp) => (
                    <div
                      key={otp.label}
                      className={`rounded-2xl p-4 ${
                        otp.tone === "success"
                          ? "bg-emerald-50 text-emerald-700"
                          : otp.tone === "warning"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-[var(--moovu-primary-soft)] text-slate-900"
                      }`}
                    >
                      <div className="text-xs font-black uppercase tracking-[0.16em] opacity-80">
                        {otp.label}
                      </div>
                      <div className="mt-2 text-3xl font-black tracking-[0.25em]">
                        {otp.value}
                      </div>
                      <div className="mt-2 text-xs font-semibold">{otp.helper}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

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

                {trip.status === "completed" && (
                  <button
                    type="button"
                    onClick={() => router.push("/")}
                    className="moovu-btn moovu-btn-primary"
                  >
                    Done
                  </button>
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
          <section className="moovu-card overflow-hidden p-0">
            <div className="bg-slate-950 p-5 text-white">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-200">
                Ride total
              </div>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-4xl font-black">{money(displayTotal)}</div>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-blue-50">
                    {fareHelperText}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/10 px-4 py-3 text-right">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-100">
                    Status
                  </div>
                  <div className="mt-1 text-sm font-black">{statusLabel(trip.status)}</div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                  Booked fare
                </div>
                <div className="mt-2 text-xl font-black text-slate-950">
                  {money(trip.fare_amount)}
                </div>
                <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
                  Shown before the driver started the trip.
                </p>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                  Route additions
                </div>
                <div className="mt-2 text-xl font-black text-slate-950">
                  {money(routeAddition)}
                </div>
                <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
                  Stops and stop-waiting amounts included where applicable.
                </p>
              </div>

              {premiumTripStats.map((item) => (
                <div key={item.label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                    {item.label}
                  </div>
                  <div className="mt-2 text-lg font-black text-slate-950 capitalize">
                    {item.value}
                  </div>
                  <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{item.helper}</p>
                </div>
              ))}

              <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-800 sm:col-span-2">
                <div className="text-xs font-black uppercase tracking-[0.16em]">
                  Secure trip
                </div>
                <p className="mt-2 text-sm font-semibold leading-6">
                  Driver details unlock after acceptance, start and end OTPs protect the trip, and your receipt remains available after completion.
                </p>
              </div>
            </div>
          </section>

            <section className="moovu-card p-5">
              <div className="text-sm font-medium text-slate-500">Trip controls</div>

              {canAddStop && (
                <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <div className="text-sm font-black text-blue-900">
                    Need to add a stop?
                  </div>
                  <p className="mt-2 text-sm font-semibold leading-6 text-blue-800">
                    You can add up to 2 stops. Extra route cost is discounted by 40%, then the total is finalized after the end OTP.
                  </p>
                  <button
                    type="button"
                    className="moovu-btn moovu-btn-primary mt-3"
                    onClick={() => setAddStopOpen(true)}
                  >
                    Add stop
                  </button>
                </div>
              )}

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
                  {cancelBusy ? "Cancelling..." : cancellationPreview.label}
                </button>

                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  {cancellationPreview.fee > 0
                    ? "A late cancellation fee applies because a driver has started travelling to your pickup."
                    : "Cancellation is currently free under the MOOVU cancellation policy."}
                </div>
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

      {canOpenChat && (
        <div className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-4 z-[8000]">
          <TripChatPanel
            tripId={trip.id}
            label="Chat with driver"
            buttonClassName="moovu-floating-chat-button"
            initialOpen={searchParams.get("chat") === "1"}
          />
        </div>
      )}
    </main>
  );
}
