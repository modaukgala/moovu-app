"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import EnableNotificationsButton from "@/components/EnableNotificationsButton";
import TripChatPanel from "@/components/trip-chat/TripChatPanel";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { getNoShowFee } from "@/lib/finance/cancellationFees";
import { notifyInApp } from "@/lib/in-app-notifications";
import {
  carMarkerIcon,
  fitBoundsToPoints,
  gpsMarkerIcon,
  makeRouteRenderer,
  stopMarkerIcon,
} from "@/lib/maps/liveMapMarkers";
import { getMoovuCurrentPosition } from "@/lib/native-permissions";
import { supabaseClient } from "@/lib/supabase/client";
import { getDriverLevel } from "@/lib/trust/driverLevels";

type Offer = {
  id: string;
  status: string;
  offer_status: string;
  offer_expires_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  distance_km?: number | null;
  duration_min?: number | null;
  fare_amount: number | null;
  payment_method: string | null;
  ride_option?: string | null;
  stops?: unknown;
  original_fare?: number | null;
  final_add_stop_increase?: number | null;
  final_fare?: number | null;
  stop_waiting_fee?: number | null;
};

type CurrentTrip = {
  id: string;
  status: string;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  fare_amount: number | null;
  payment_method: string | null;
  rider_name?: string | null;
  rider_phone?: string | null;
  created_at: string | null;
  driver_arrived_at?: string | null;
  no_show_eligible_at?: string | null;
  ride_option?: string | null;
  stops?: unknown;
  original_fare?: number | null;
  final_add_stop_increase?: number | null;
  final_fare?: number | null;
  stop_waiting_fee?: number | null;
};

type TripStop = {
  address: string;
  lat: number;
  lng: number;
};

type Driver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string | null;
  online: boolean | null;
  busy: boolean | null;
  profile_completed?: boolean | null;
  verification_status?: string | null;
  subscription_status?: string | null;
  subscription_expires_at?: string | null;
  subscription_plan?: string | null;
  lat: number | null;
  lng: number | null;
  last_seen: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_registration?: string | null;
};

type GpsNotice = {
  message: string;
  tone: "success" | "warning" | "danger" | "info";
};

type DriverEarningsTrip = {
  driver_net_earnings?: number | string | null;
  fare_amount?: number | string | null;
  commission_amount?: number | string | null;
  completed_at?: string | null;
  created_at?: string | null;
};

type DriverEarningsSnapshot = {
  todayEarnings: number;
  todayTrips: number;
  weekEarnings: number;
  amountOwed: number;
  completedTrips: number;
};

declare global {
  interface Window {
    google: typeof google;
  }
}

const DEFAULT_CENTER = { lat: -25.12, lng: 29.05 };

function googleMapsLink(lat: number | null | undefined, lng: number | null | undefined) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
}

function wazeLink(lat: number | null | undefined, lng: number | null | undefined) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return `https://waze.com/ul?ll=${encodeURIComponent(`${lat},${lng}`)}&navigate=yes`;
}

function tripStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "assigned":
      return "Head to pickup";
    case "arrived":
      return "Waiting for OTP";
    case "ongoing":
      return "Drive to destination";
    case "completed":
      return "Completed";
    default:
      return status || "No trip";
  }
}

function rideTypeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "group" || normalized === "xl" || normalized.includes("xl")) return "MOOVU Go XL";
  if (normalized === "scheduled") return "Scheduled ride";
  return "MOOVU Go";
}

function driverStageDetail(params: {
  driver: Driver | null;
  offer: Offer | null;
  currentTrip: CurrentTrip | null;
}) {
  const { driver, offer, currentTrip } = params;
  if (offer) {
    return {
      eyebrow: "New request",
      title: "New trip nearby",
      body: "Review pickup, destination, fare and timer before accepting.",
      action: "Accept or decline",
    };
  }
  if (currentTrip?.status === "assigned") {
    return {
      eyebrow: "Stage 1",
      title: "Navigate to pickup",
      body: "Drive to the pickup point, then mark arrived when you reach the customer.",
      action: "Drive to pickup",
    };
  }
  if (currentTrip?.status === "arrived") {
    return {
      eyebrow: "Stage 2",
      title: "Verify pickup OTP",
      body: "Ask the customer for the start OTP before the ride begins.",
      action: "Start trip with OTP",
    };
  }
  if (currentTrip?.status === "ongoing") {
    return {
      eyebrow: "Stage 4",
      title: "Trip in progress",
      body: "Drive to destination and complete the ride with the end OTP.",
      action: "Complete trip",
    };
  }
  return {
    eyebrow: driver?.online ? "Online" : "Offline",
    title: driver?.online ? "Ready for nearby requests" : "Go online to drive",
    body: driver?.online
      ? "Keep GPS active and stay ready for local MOOVU trip offers."
      : "Go online when you are available, subscribed, and ready to accept rides.",
    action: driver?.online ? "Waiting for request" : "Go online",
  };
}

function gpsNoticeClass(tone: GpsNotice["tone"]) {
  switch (tone) {
    case "success":
      return "border-emerald-100 bg-emerald-50 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "danger":
      return "border-red-100 bg-red-50 text-red-700";
    default:
      return "border-blue-100 bg-blue-50 text-blue-700";
  }
}

function friendlyGeolocationError(err: GeolocationPositionError): GpsNotice {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return {
        tone: "warning",
        message:
          "Location permission is blocked. Allow location access for MOOVU in your browser or app settings, then tap Save current GPS. You can use manual location meanwhile.",
      };
    case err.POSITION_UNAVAILABLE:
      return {
        tone: "danger",
        message:
          "MOOVU could not read your GPS position. Check that location services are on, then try again.",
      };
    case err.TIMEOUT:
      return {
        tone: "warning",
        message:
          "GPS took too long to respond. Move to an open area or check your signal, then try again.",
      };
    default:
      return {
        tone: "danger",
        message: "MOOVU could not refresh GPS. Check location access and try again.",
      };
  }
}

function gpsNoticeMessage(notice: GpsNotice | string) {
  return typeof notice === "string" ? notice : notice.message;
}

function gpsNoticeTone(notice: GpsNotice | string): GpsNotice["tone"] {
  if (typeof notice !== "string") return notice.tone;
  return notice.toLowerCase().includes("gps live") ? "success" : "info";
}

function parseTripStops(value: unknown): TripStop[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 2)
    .map((stop) => {
      const item = (stop ?? {}) as { address?: unknown; lat?: unknown; lng?: unknown };
      return {
        address: typeof item.address === "string" ? item.address : "",
        lat: Number(item.lat),
        lng: Number(item.lng),
      };
    })
    .filter((stop) => stop.address.trim() && Number.isFinite(stop.lat) && Number.isFinite(stop.lng));
}

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function subscriptionTone(driver: Driver | null) {
  if (!driver) {
    return {
      label: "Inactive",
      message: "Your subscription must be active to receive trips.",
      className: "border-red-100 bg-red-50 text-red-700",
    };
  }

  const status = String(driver.subscription_status ?? "").toLowerCase();
  const expiryMs = driver.subscription_expires_at
    ? new Date(driver.subscription_expires_at).getTime()
    : NaN;
  const daysLeft = Number.isFinite(expiryMs)
    ? Math.ceil((expiryMs - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  if (status === "active" || status === "grace") {
    if (daysLeft != null && daysLeft <= 3) {
      return {
        label: "Expiring soon",
        message: "Your subscription is expiring soon. Renew to keep receiving trips.",
        className: "border-amber-200 bg-amber-50 text-amber-800",
      };
    }
    return {
      label: "Active",
      message: "Only active subscribed drivers receive trips.",
      className: "border-emerald-100 bg-emerald-50 text-emerald-700",
    };
  }

  return {
    label: "Inactive",
    message: "Your subscription must be active to receive trips.",
    className: "border-red-100 bg-red-50 text-red-700",
  };
}

export default function DriverHomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [driver, setDriver] = useState<Driver | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [currentTrip, setCurrentTrip] = useState<CurrentTrip | null>(null);
  const [earningsSnapshot, setEarningsSnapshot] = useState<DriverEarningsSnapshot>({
    todayEarnings: 0,
    todayTrips: 0,
    weekEarnings: 0,
    amountOwed: 0,
    completedTrips: 0,
  });

  const [locationName, setLocationName] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [driverActionError, setDriverActionError] = useState<string | null>(null);
  const [gpsInfo, setGpsInfo] = useState<GpsNotice | string | null>(null);
  const [loadingDriver, setLoadingDriver] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [mapError, setMapError] = useState<string | null>(null);

  const [startOtp, setStartOtp] = useState("");
  const [showStartOtp, setShowStartOtp] = useState(false);
  const [endOtp, setEndOtp] = useState("");
  const [showEndOtp, setShowEndOtp] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<"pickup" | "dropoff" | null>(null);

  const subscriptionReminder = subscriptionTone(driver);
  const driverLevel = getDriverLevel(earningsSnapshot.completedTrips);
  const otpEntryOpen = showStartOtp || showEndOtp;
  const canOpenTripChat =
    !!currentTrip?.driver_id &&
    ["assigned", "arrived", "ongoing"].includes(currentTrip.status);
  const shouldOpenChatFromNotification = searchParams.get("chat") === "1";
  const notificationTripId = searchParams.get("tripId") || searchParams.get("offerTripId") || "";

  const offersTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tripTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsPermissionBlockedRef = useRef(false);
  const lastNotifiedOfferIdRef = useRef<string | null>(null);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const mapInitializedRef = useRef(false);
  const mapContainerNodeRef = useRef<HTMLDivElement | null>(null);

  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const stopMarkerRefs = useRef<google.maps.Marker[]>([]);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  function showDriverActionError(message: string) {
    setDriverActionError(message);
    setInfo(null);
  }

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function safeGetSession() {
    try {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error || !data.session) {
        window.location.href = "/driver/login";
        return null;
      }
      return data.session;
    } catch {
      window.location.href = "/driver/login";
      return null;
    }
  }

  async function getAccessToken() {
    const session = await safeGetSession();
    return session?.access_token ?? null;
  }

  async function loadDriverProfile(silent = false) {
    if (!silent) {
      setLoadingDriver(true);
      setInfo(null);
    }

    const session = await safeGetSession();
    if (!session) {
      if (!silent) setLoadingDriver(false);
      return null;
    }

    const res = await fetch("/api/driver/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok || !json?.driver) {
      if (!silent) {
        setDriver(null);
        setInfo(json?.error || "Driver record not found.");
      }
      if (!silent) setLoadingDriver(false);
      return null;
    }

    setDriver(json.driver as Driver);
    if (!silent) setLoadingDriver(false);
    return json.driver as Driver;
  }

  async function loadCurrentOffer() {
    const token = await getAccessToken();
    if (!token) return;

    const res = await fetch("/api/driver/offers/current", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);
    if (!json?.ok) return;

    setOffer(json.offer ?? null);
  }

  async function loadCurrentTrip() {
    const token = await getAccessToken();
    if (!token) return;

    const res = await fetch("/api/driver/current-trip", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);
    if (!json?.ok) return;

    setCurrentTrip(json.trip ?? null);
  }

  async function loadEarningsSnapshot() {
    const token = await getAccessToken();
    if (!token) return;

    const json = await fetch("/api/driver/earnings", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((res) => res.json())
      .catch(() => null);
    if (!json?.ok) return;

    const earnings = (json.earnings ?? {}) as {
      wallet?: { balance_due?: number | string | null } | null;
      recent_completed_trips?: DriverEarningsTrip[] | null;
    };
    const trips = earnings.recent_completed_trips ?? [];
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    let todayTrips = 0;
    let todayEarnings = 0;
    let weekEarnings = 0;

    for (const trip of trips) {
      const completedAt = trip.completed_at ?? trip.created_at;
      const completedMs = completedAt ? new Date(completedAt).getTime() : NaN;
      const earned =
        trip.driver_net_earnings != null
          ? num(trip.driver_net_earnings)
          : Math.max(0, num(trip.fare_amount) - num(trip.commission_amount));

      if (completedAt?.slice(0, 10) === todayKey) {
        todayTrips += 1;
        todayEarnings += earned;
      }

      if (Number.isFinite(completedMs) && completedMs >= weekStart.getTime()) {
        weekEarnings += earned;
      }
    }

    setEarningsSnapshot({
      todayEarnings,
      todayTrips,
      weekEarnings,
      amountOwed: num(earnings.wallet?.balance_due),
      completedTrips: trips.length,
    });
  }

  async function setOnlineServer(wantOnline: boolean) {
    if (wantOnline && !driver?.profile_completed) {
      showDriverActionError("Complete your application before going online.");
      return;
    }

    setBusy(true);
    setInfo(null);
    setDriverActionError(null);

    if (wantOnline) {
      await captureCurrentLocationAndSave(false);
    }

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch("/api/driver/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ online: wantOnline }),
    });

    const json = await res.json().catch(() => null);

    setBusy(false);

    if (!json?.ok) {
      showDriverActionError(json?.error || "Failed to update online status");
      await loadDriverProfile(true);
      return;
    }

    setInfo(wantOnline ? "You are online." : "You are offline.");
    await loadDriverProfile(true);
  }

  async function saveLocationFromName() {
    if (!driver) return;

    const place = locationName.trim();
    if (!place) {
      setInfo("Type a place name first.");
      return;
    }

    setBusy(true);
    setInfo(null);

    const res = await fetch("/api/maps/geocode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ place }),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setBusy(false);
      setInfo(json?.error || "Location not found");
      return;
    }

    await supabaseClient
      .from("drivers")
      .update({
        lat: json.lat,
        lng: json.lng,
        last_seen: new Date().toISOString(),
      })
      .eq("id", driver.id);

    setBusy(false);
    setInfo(`Location saved: ${json.address ?? place}`);
    await loadDriverProfile(true);
  }

  async function sendHeartbeat(lat: number, lng: number) {
    const token = await getAccessToken();
    if (!token) return false;

    const res = await fetch("/api/driver/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ lat, lng }),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setGpsInfo({
        tone: "danger",
        message: json?.error || "GPS heartbeat failed. Try refreshing your location.",
      });
      return false;
    }

    setGpsInfo(`GPS live - ${new Date().toLocaleTimeString()}`);
    return true;
  }

  async function captureCurrentLocationAndSave(silent = false) {
    return new Promise<boolean>((resolve) => {
      if (silent && gpsPermissionBlockedRef.current) {
        resolve(false);
        return;
      }

      getMoovuCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      }).then(
        async (pos) => {
          gpsPermissionBlockedRef.current = false;
          const ok = await sendHeartbeat(pos.coords.latitude, pos.coords.longitude);
          await loadDriverProfile(silent);
          resolve(ok);
        },
        (err) => {
          const notice = friendlyGeolocationError(err as GeolocationPositionError);
          setGpsInfo(notice);
          if (!silent) {
            showDriverActionError(notice.message);
          }

          if ((err as GeolocationPositionError).code === 1) {
            gpsPermissionBlockedRef.current = true;
            if (gpsTimerRef.current) {
              clearInterval(gpsTimerRef.current);
              gpsTimerRef.current = null;
            }
          }

          resolve(false);
        }
      );
    });
  }

  async function retryCurrentGps() {
    gpsPermissionBlockedRef.current = false;
    setGpsInfo({
      tone: "info",
      message: "Checking GPS permission...",
    });
    await captureCurrentLocationAndSave(false);
  }

  async function respondToOffer(action: "accept" | "reject") {
    if (!offer) return;

    setBusy(true);
    setInfo(null);
    setDriverActionError(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch("/api/driver/offers/respond", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tripId: offer.id,
        action,
      }),
    });

    const json = await res.json().catch(() => null);
    setBusy(false);

    if (!json?.ok) {
      showDriverActionError(json?.error || "Failed to respond to offer.");
      await loadCurrentOffer();
      await loadCurrentTrip();
      return;
    }

    setInfo(action === "accept" ? "Offer accepted." : "Offer declined.");
    notifyInApp({
      title: action === "accept" ? "Trip accepted" : "Trip declined",
      body: action === "accept" ? "MOOVU is opening this trip for you." : "You will not receive this offer again.",
      tone: action === "accept" ? "success" : "info",
      loud: action === "accept",
    });
    await loadCurrentOffer();
    await loadCurrentTrip();
    await loadDriverProfile(true);
    await loadEarningsSnapshot();
  }

  async function tripAction(
    endpoint: string,
    payload: Record<string, unknown>,
    successMsg: string
  ) {
    setBusy(true);
    setInfo(null);
    setDriverActionError(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => null);
    setBusy(false);

    if (!json?.ok) {
      showDriverActionError(json?.error || "Action failed");
      await loadCurrentTrip();
      await loadDriverProfile(true);
      return;
    }

    setInfo(successMsg);
    notifyInApp({
      title: successMsg,
      body: endpoint.includes("/start")
        ? "Start OTP verified. The trip is now active."
        : endpoint.includes("/complete")
          ? "End OTP verified. The trip has been completed."
          : "MOOVU saved this trip update.",
      tone: endpoint.includes("/complete") || endpoint.includes("/start") ? "success" : "info",
      loud: endpoint.includes("/start") || endpoint.includes("/complete"),
    });
    await loadCurrentTrip();
    await loadDriverProfile(true);
    await loadEarningsSnapshot();
  }

  async function arriveTrip(tripId: string) {
    await tripAction("/api/driver/trips/arrive", { tripId }, "Marked as arrived âœ…");
  }

  async function startTrip(tripId: string, otp: string) {
    await tripAction("/api/driver/trips/start", { tripId, otp }, "Trip started âœ…");
  }

  async function completeTrip(tripId: string, otp: string) {
    await tripAction("/api/driver/trips/complete", { tripId, otp }, "Trip completed âœ…");
  }

  async function markNoShow(tripId: string) {
    await tripAction(
      "/api/driver/trips/no-show",
      { tripId },
      "Customer no-show recorded."
    );
  }

  async function logout() {
    try {
      await supabaseClient.auth.signOut({ scope: "local" });
    } catch {
      // ignore
    }
    window.location.href = "/driver/login";
  }

  function clearMapLayers() {
    if (driverMarkerRef.current) driverMarkerRef.current.setMap(null);
    if (pickupMarkerRef.current) pickupMarkerRef.current.setMap(null);
    if (dropoffMarkerRef.current) dropoffMarkerRef.current.setMap(null);
    if (directionsRendererRef.current) directionsRendererRef.current.setMap(null);
    stopMarkerRefs.current.forEach((marker) => marker.setMap(null));

    driverMarkerRef.current = null;
    pickupMarkerRef.current = null;
    dropoffMarkerRef.current = null;
    directionsRendererRef.current = null;
    stopMarkerRefs.current = [];
  }

  function updateMapObjects() {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps || !driver) return;

    clearMapLayers();
    const routePreview = currentTrip ?? offer;
    const routeStops = parseTripStops(routePreview?.stops);

    const points: google.maps.LatLngLiteral[] = [];

    if (typeof driver.lat === "number" && typeof driver.lng === "number") {
      const driverPos = { lat: driver.lat, lng: driver.lng };
      driverMarkerRef.current = new window.google.maps.Marker({
        map,
        position: driverPos,
        title: "You",
        icon: currentTrip || offer ? carMarkerIcon() : gpsMarkerIcon(),
      });
      points.push(driverPos);
    }

    if (routePreview?.pickup_lat != null && routePreview?.pickup_lng != null) {
      const pickupPos = { lat: routePreview.pickup_lat, lng: routePreview.pickup_lng };
      pickupMarkerRef.current = new window.google.maps.Marker({
        map,
        position: pickupPos,
        title: "Pickup",
        icon: stopMarkerIcon("P"),
      });
      points.push(pickupPos);
    }

    if (routePreview?.dropoff_lat != null && routePreview?.dropoff_lng != null) {
      const dropoffPos = { lat: routePreview.dropoff_lat, lng: routePreview.dropoff_lng };
      dropoffMarkerRef.current = new window.google.maps.Marker({
        map,
        position: dropoffPos,
        title: "Dropoff",
        icon: stopMarkerIcon("D"),
      });
      points.push(dropoffPos);
    }

    routeStops.forEach((stop, index) => {
      const stopPos = { lat: stop.lat, lng: stop.lng };
      stopMarkerRefs.current.push(new window.google.maps.Marker({
        map,
        position: stopPos,
        title: `Stop ${index + 1}`,
        icon: stopMarkerIcon(index === 0 ? "1" : "2"),
      }));
      points.push(stopPos);
    });

    if (points.length > 0) {
      fitBoundsToPoints(map, points);
    } else {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(11);
    }

    const hasOrigin = driver.lat != null && driver.lng != null;
    const goingToPickup = currentTrip?.status === "assigned" || (!!offer && !currentTrip);
    const goingToDropoff =
      currentTrip?.status === "arrived" || currentTrip?.status === "ongoing";

    let destLat: number | null = null;
    let destLng: number | null = null;

    if (goingToPickup) {
      destLat = routePreview?.pickup_lat ?? null;
      destLng = routePreview?.pickup_lng ?? null;
    } else if (goingToDropoff) {
      destLat = currentTrip?.dropoff_lat ?? null;
      destLng = currentTrip?.dropoff_lng ?? null;
    }

    if (hasOrigin && destLat != null && destLng != null) {
      const directionsService = new window.google.maps.DirectionsService();
      const directionsRenderer = makeRouteRenderer(map);
      directionsRendererRef.current = directionsRenderer;

      directionsService.route(
        {
          origin: { lat: driver.lat!, lng: driver.lng! },
          destination: { lat: destLat, lng: destLng },
          waypoints:
            currentTrip?.status === "ongoing"
              ? routeStops.map((stop) => ({
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
  }

  function tryCreateMap() {
    if (!mapRef.current) return false;
    if (!window.google?.maps) return false;

    const currentNode = mapRef.current;
    const containerChanged =
      !!mapContainerNodeRef.current && mapContainerNodeRef.current !== currentNode;

    if (!mapInitializedRef.current || !mapInstanceRef.current || containerChanged) {
      mapInstanceRef.current = new window.google.maps.Map(currentNode, {
        center: DEFAULT_CENTER,
        zoom: 11,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
      });

      mapContainerNodeRef.current = currentNode;
      mapInitializedRef.current = true;
      setMapError(null);
    }

    return true;
  }

  useEffect(() => {
    (async () => {
      await loadDriverProfile(false);
      await loadCurrentOffer();
      await loadCurrentTrip();
      await loadEarningsSnapshot();
    })();
    // Initial dashboard load only; polling effects below refresh offer/trip state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (offersTimerRef.current) clearInterval(offersTimerRef.current);
    if (!driver?.online) return;

    offersTimerRef.current = setInterval(() => {
      loadCurrentOffer();
    }, 3000);

    return () => {
      if (offersTimerRef.current) clearInterval(offersTimerRef.current);
    };
    // Polling is keyed to online state; the loader reads the current auth session each tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.online]);

  useEffect(() => {
    if (tripTimerRef.current) clearInterval(tripTimerRef.current);
    if (!driver?.online || otpEntryOpen) return;

    tripTimerRef.current = setInterval(() => {
      loadCurrentTrip();
    }, 3000);

    return () => {
      if (tripTimerRef.current) clearInterval(tripTimerRef.current);
    };
    // Polling is keyed to online/OTP state so OTP entry is not disrupted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.online, otpEntryOpen]);

  useEffect(() => {
    if (!searchParams.get("offerTripId")) return;
    document
      .getElementById("driver-trip-offer-card")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [offer?.id, searchParams]);

  useEffect(() => {
    if (!offer?.id) {
      lastNotifiedOfferIdRef.current = null;
      return;
    }

    if (lastNotifiedOfferIdRef.current === offer.id) return;
    lastNotifiedOfferIdRef.current = offer.id;

    notifyInApp({
      title: "New trip offer",
      body: `${offer.pickup_address ?? "Pickup"} to ${offer.dropoff_address ?? "destination"}`,
      tone: "offer",
      url: `/driver?offerTripId=${encodeURIComponent(offer.id)}`,
      loud: true,
    });
  }, [offer?.dropoff_address, offer?.id, offer?.pickup_address]);

  useEffect(() => {
    if (gpsTimerRef.current) clearInterval(gpsTimerRef.current);
    let clearGpsInfoTimer: ReturnType<typeof setTimeout> | null = null;

    if (!driver?.online) {
      clearGpsInfoTimer = setTimeout(() => setGpsInfo(null), 0);
      gpsPermissionBlockedRef.current = false;
      return () => {
        if (clearGpsInfoTimer) clearTimeout(clearGpsInfoTimer);
      };
    }

    gpsPermissionBlockedRef.current = false;
    captureCurrentLocationAndSave(true);

    gpsTimerRef.current = setInterval(() => {
      captureCurrentLocationAndSave(true);
    }, 5000);

    return () => {
      if (gpsTimerRef.current) clearInterval(gpsTimerRef.current);
    };
    // GPS polling intentionally starts/stops only with online state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.online]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
    if (!apiKey) {
      const timer = window.setTimeout(() => {
        setMapError("Google Maps API key is missing.");
      }, 0);

      return () => window.clearTimeout(timer);
    }

    function initWhenReady() {
      if (cancelled) return;
      if (!tryCreateMap()) {
        retryTimer = setTimeout(initWhenReady, 150);
        return;
      }
      updateMapObjects();
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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = initWhenReady;
    script.onerror = () => setMapError("Failed to load Google Maps script.");
    document.body.appendChild(script);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // Google Maps script bootstraps once; map object updates are handled by the coordinate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapInitializedRef.current) return;
    updateMapObjects();
    // updateMapObjects reads refs and the selected trip/driver fields listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    driver?.lat,
    driver?.lng,
    currentTrip?.id,
    currentTrip?.status,
    currentTrip?.pickup_lat,
    currentTrip?.pickup_lng,
    currentTrip?.dropoff_lat,
    currentTrip?.dropoff_lng,
    offer?.id,
    offer?.pickup_lat,
    offer?.pickup_lng,
    offer?.dropoff_lat,
    offer?.dropoff_lng,
  ]);

  const secondsLeft = useMemo(() => {
    if (!offer?.offer_expires_at) return null;
    return Math.max(
      0,
      Math.ceil((new Date(offer.offer_expires_at).getTime() - nowMs) / 1000)
    );
  }, [offer?.offer_expires_at, nowMs]);

  const pickupGoogle = googleMapsLink(currentTrip?.pickup_lat, currentTrip?.pickup_lng);
  const pickupWaze = wazeLink(currentTrip?.pickup_lat, currentTrip?.pickup_lng);
  const dropoffGoogle = googleMapsLink(currentTrip?.dropoff_lat, currentTrip?.dropoff_lng);
  const dropoffWaze = wazeLink(currentTrip?.dropoff_lat, currentTrip?.dropoff_lng);
  const noShowSecondsLeft = useMemo(() => {
    if (!currentTrip?.no_show_eligible_at) return null;
    return Math.max(
      0,
      Math.ceil((new Date(currentTrip.no_show_eligible_at).getTime() - nowMs) / 1000)
    );
  }, [currentTrip?.no_show_eligible_at, nowMs]);
  const currentNoShowFee = useMemo(
    () => getNoShowFee(currentTrip?.ride_option),
    [currentTrip?.ride_option]
  );
  const offerStops = useMemo(() => parseTripStops(offer?.stops), [offer?.stops]);
  const currentTripStops = useMemo(() => parseTripStops(currentTrip?.stops), [currentTrip?.stops]);
  const stageDetail = useMemo(
    () => driverStageDetail({ driver, offer, currentTrip }),
    [currentTrip, driver, offer]
  );
  const driverMode = currentTrip
    ? "ACTIVE TRIP"
    : offer
      ? "NEW TRIP"
      : driver?.online
        ? "ONLINE"
        : "OFFLINE";
  const driverModeClass = currentTrip
    ? "is-busy"
    : offer
      ? "is-offer"
      : driver?.online
        ? "is-online"
        : "is-offline";
  const driverModeCopy = currentTrip
    ? stageDetail.action
    : offer
      ? "Accept or decline"
      : driver?.online
        ? "Waiting for trips nearby"
        : "Ready to earn today?";
  const primaryOnlineAction = driver?.online ? "GO OFFLINE" : "GO ONLINE";

  if (loadingDriver) {
    return (
      <main className="moovu-page text-black">
        <div className="moovu-shell p-6">
          <div className="moovu-card p-6">
            <div className="moovu-section-title">MOOVU Driver</div>
            <div className="mt-4 space-y-3">
              <div className="moovu-skeleton h-6 w-48" />
              <div className="moovu-skeleton h-28 w-full" />
              <div className="moovu-skeleton h-48 w-full" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="moovu-page moovu-driver-shell text-black">
      {driverActionError && (
        <CenteredMessageBox
          title="Action needs attention"
          message={driverActionError}
          onClose={() => setDriverActionError(null)}
        />
      )}

      {navigationTarget && (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <section className="moovu-driver-nav-sheet w-full max-w-sm">
            <div className="moovu-section-title">Open navigation</div>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
              {navigationTarget === "pickup" ? "Drive to pickup" : "Drive to destination"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Choose your preferred map app for this trip leg.
            </p>

            <div className="mt-5 grid gap-3">
              {(navigationTarget === "pickup" ? pickupGoogle : dropoffGoogle) && (
                <a
                  className="moovu-nav-choice"
                  href={navigationTarget === "pickup" ? pickupGoogle ?? "#" : dropoffGoogle ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setNavigationTarget(null)}
                >
                  <span className="moovu-nav-choice-icon">G</span>
                  <span>
                    <span className="block text-sm font-black text-slate-950">Google Maps</span>
                    <span className="block text-xs font-semibold text-slate-500">Open turn-by-turn directions</span>
                  </span>
                </a>
              )}

              {(navigationTarget === "pickup" ? pickupWaze : dropoffWaze) && (
                <a
                  className="moovu-nav-choice"
                  href={navigationTarget === "pickup" ? pickupWaze ?? "#" : dropoffWaze ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setNavigationTarget(null)}
                >
                  <span className="moovu-nav-choice-icon">W</span>
                  <span>
                    <span className="block text-sm font-black text-slate-950">Waze</span>
                    <span className="block text-xs font-semibold text-slate-500">Use Waze traffic guidance</span>
                  </span>
                </a>
              )}

              <button
                type="button"
                className="moovu-btn moovu-btn-secondary w-full"
                onClick={() => setNavigationTarget(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}

      {offer && (
        <section className="moovu-driver-offer-drop" aria-live="assertive">
          <div className="moovu-driver-offer-drop-inner">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="moovu-driver-offer-alert-dot" />
                <span className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
                  NEW TRIP NEARBY
                </span>
                <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-black text-blue-800">
                  {secondsLeft != null ? `${secondsLeft}s left` : "Respond now"}
                </span>
              </div>
              <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                {money(offer.final_fare ?? offer.fare_amount)}
              </div>
              <div className="mt-1 text-sm font-black uppercase tracking-[0.12em] text-slate-500">
                {rideTypeLabel(offer.ride_option)} - {offer.distance_km == null ? "Distance pending" : `${Number(offer.distance_km).toFixed(1)} km`} - {offer.duration_min == null ? "Time pending" : `${Math.round(Number(offer.duration_min))} min`}
              </div>
              <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-700 sm:grid-cols-2">
                <div className="truncate">
                  <span className="text-slate-400">Pickup:</span> {offer.pickup_address ?? "-"}
                </div>
                <div className="truncate">
                  <span className="text-slate-400">Dropoff:</span> {offer.dropoff_address ?? "-"}
                </div>
              </div>
              {offerStops.length > 0 && (
                <div className="mt-2 rounded-2xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">
                  Stops: {offerStops.map((stop, index) => `Stop ${index + 1}: ${stop.address}`).join(" | ")}
                </div>
              )}
            </div>

            <div className="grid min-w-full grid-cols-2 gap-2 sm:min-w-[230px]">
              <button
                type="button"
                className="moovu-driver-accept"
                disabled={busy || secondsLeft === 0}
                onClick={() => respondToOffer("accept")}
              >
                ACCEPT
              </button>
              <button
                type="button"
                className="moovu-driver-decline"
                disabled={busy || secondsLeft === 0}
                onClick={() => respondToOffer("reject")}
              >
                DECLINE
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="moovu-shell">
        <section className="moovu-driver-os-hero mb-4">
          <div className="min-w-0">
            <div className="moovu-section-title">{stageDetail.eyebrow}</div>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              {stageDetail.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
              {stageDetail.body}
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-5">
              {["Online", "Offer", "Pickup", "Trip", "Complete"].map((step, index) => {
                const active =
                  (index === 0 && !!driver?.online) ||
                  (index === 1 && !!offer) ||
                  (index === 2 && currentTrip?.status === "assigned") ||
                  (index === 3 && (currentTrip?.status === "arrived" || currentTrip?.status === "ongoing")) ||
                  (index === 4 && currentTrip?.status === "completed");
                return (
                  <div key={step} className={active ? "moovu-driver-step is-active" : "moovu-driver-step"}>
                    <span />
                    <strong>{step}</strong>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="moovu-driver-os-side">
            <div className="moovu-driver-os-action">
              <span>Next action</span>
              <strong>{stageDetail.action}</strong>
            </div>
            <EnableNotificationsButton role="driver" variant="inline" />
            <button className="moovu-btn moovu-btn-secondary" onClick={logout}>
              Logout
            </button>
          </div>
        </section>

        {(info || gpsInfo) && (
          <div className="mb-4 grid gap-3 md:grid-cols-2">
            {info && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                {info}
              </div>
            )}

            {gpsInfo && (
              <div
                className={`rounded-2xl border px-4 py-3 text-sm ${gpsNoticeClass(gpsNoticeTone(gpsInfo))}`}
              >
                <div>{gpsNoticeMessage(gpsInfo)}</div>
                {gpsNoticeTone(gpsInfo) !== "success" && (
                  <button
                    type="button"
                    className="mt-2 rounded-xl bg-white/80 px-3 py-2 text-xs font-bold text-slate-900 shadow-sm"
                    onClick={() => void retryCurrentGps()}
                    disabled={busy}
                  >
                    Retry GPS
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {!driver ? (
          <div className="moovu-card p-6 text-slate-700">
            Driver record not found.
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1.28fr_0.72fr]">
            <section className="moovu-driver-home-stack">
              <div className={`moovu-driver-cockpit p-5 ${driver.online ? "is-online" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div>
                    <div className="moovu-section-title">Today Earnings</div>
                    <div className="moovu-driver-big-money">
                      {money(earningsSnapshot.todayEarnings)}
                    </div>
                    <div className="mt-2 text-sm font-bold text-slate-600">
                      {driver.online ? "You are online and ready for trips." : "Ready to earn today?"}
                    </div>
                  </div>

                  <div className={driver.online ? "moovu-chip moovu-chip-success" : "moovu-chip moovu-chip-warning"}>
                    <span className="moovu-chip-dot" />
                    {driver.online ? "ONLINE" : "OFFLINE"}
                  </div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-4">
                  <div className="moovu-driver-soft-stat">
                    <span>Trips</span>
                    <strong>{earningsSnapshot.todayTrips}</strong>
                  </div>
                  <div className="moovu-driver-soft-stat">
                    <span>Week</span>
                    <strong>{money(earningsSnapshot.weekEarnings)}</strong>
                  </div>
                  <button
                    type="button"
                    className="moovu-driver-soft-stat is-action"
                    onClick={() => router.push("/driver/earnings")}
                  >
                    <span>Owed</span>
                    <strong>{money(earningsSnapshot.amountOwed)}</strong>
                  </button>
                  <button
                    type="button"
                    className="moovu-driver-soft-stat is-action"
                    onClick={() => router.push("/driver/subscriptions")}
                  >
                    <span>Subscription</span>
                    <strong>{subscriptionReminder.label}</strong>
                  </button>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-blue-50 p-4 text-sm font-bold text-blue-800">
                  <span>Stay online to receive nearby requests.</span>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${driverLevel.className}`}>
                    {driverLevel.label} driver
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button
                    className={driver.online ? "moovu-driver-toggle-off" : "moovu-driver-toggle-on"}
                    disabled={busy}
                    onClick={() => setOnlineServer(!driver.online)}
                  >
                    {primaryOnlineAction}
                  </button>

                  <button
                    className="moovu-btn moovu-btn-secondary"
                    onClick={() => router.push("/driver/complete-profile")}
                  >
                    Account
                  </button>
                </div>
              </div>

              <div className="moovu-driver-map-card">
                <div className={`moovu-driver-map-status ${driverModeClass}`}>
                  <span>{driverMode}</span>
                  <strong>{driverModeCopy}</strong>
                </div>
                <div className="absolute right-4 top-4 z-10 rounded-full bg-white/95 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-blue-700 shadow">
                  Driver map
                </div>

                {mapError ? (
                  <div className="flex h-[58vh] items-center justify-center bg-slate-50 p-6 text-sm text-slate-700">
                    {mapError}
                  </div>
                ) : (
                  <div ref={mapRef} className="h-[58vh] w-full bg-slate-100" />
                )}

                <div className="moovu-driver-map-sheet">
                  <div className="moovu-driver-map-sheet-grid">
                    <div>
                      <div className="moovu-section-title">Status</div>
                      <div className="mt-1 text-2xl font-black tracking-tight text-slate-950">
                        {driverMode}
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-600">
                        {driverModeCopy}
                      </div>
                    </div>

                    <div className="moovu-driver-earnings-mini">
                      <span>Today</span>
                      <strong>{money(earningsSnapshot.todayEarnings)}</strong>
                      <small>{earningsSnapshot.todayTrips} trips - Owed {money(earningsSnapshot.amountOwed)}</small>
                    </div>

                    <div className="moovu-driver-go-panel">
                      <button
                        type="button"
                        className={driver.online ? "moovu-driver-go-button is-online" : "moovu-driver-go-button"}
                        disabled={busy}
                        onClick={() => setOnlineServer(!driver.online)}
                      >
                        {busy ? "WORKING..." : primaryOnlineAction}
                      </button>
                      <div className="mt-2 text-center text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                        {driver.lat != null && driver.lng != null ? "GPS live" : "GPS pending"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {currentTrip && (
                <div className="moovu-driver-active-trip p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="moovu-section-title">Active trip</div>
                      <div className="mt-1 text-2xl font-black text-slate-950">
                        {tripStatusLabel(currentTrip.status)}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-600">
                        {rideTypeLabel(currentTrip.ride_option)} - {money(currentTrip.final_fare ?? currentTrip.fare_amount)}
                      </p>
                    </div>

                    <div className="moovu-chip moovu-chip-primary">
                      <span className="moovu-chip-dot" />
                      Fare: {money(currentTrip.final_fare ?? currentTrip.fare_amount)}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 p-4 md:col-span-2">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Customer</div>
                      <div className="mt-1 text-sm font-black text-slate-900">
                        {currentTrip.rider_name ?? "Customer"}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-600">
                        {currentTrip.rider_phone ?? "Phone available when captured"}
                      </div>
                      {currentTrip.rider_phone && (
                        <a href={`tel:${currentTrip.rider_phone}`} className="moovu-btn moovu-btn-secondary mt-3 w-full sm:w-auto">
                          Call customer
                        </a>
                      )}
                    </div>

                    <div className="rounded-2xl bg-[var(--moovu-primary-soft)] p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Pickup</div>
                      <div className="mt-1 text-sm font-medium text-slate-900">
                        {currentTrip.pickup_address ?? "-"}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Dropoff</div>
                      <div className="mt-1 text-sm font-medium text-slate-900">
                        {currentTrip.dropoff_address ?? "-"}
                      </div>
                    </div>
                  </div>

                  {currentTripStops.length > 0 && (
                    <div className="mt-3 rounded-[24px] border border-blue-100 bg-blue-50 p-4">
                      <div className="text-xs font-black uppercase tracking-[0.12em] text-blue-700">Trip stops</div>
                      <div className="mt-3 grid gap-2">
                        {currentTripStops.map((stop, index) => (
                          <div key={`${stop.address}-${index}`} className="rounded-2xl bg-white/85 p-3 text-sm font-semibold text-slate-900">
                            Stop {index + 1}: {stop.address}
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 text-xs font-semibold text-blue-800">
                        First 3 minutes waiting at each stop are free. Maximum 10 minutes per stop.
                      </div>
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {currentTrip.status === "assigned" && (pickupGoogle || pickupWaze) && (
                      <button
                        type="button"
                        className="moovu-driver-nav-button"
                        onClick={() => setNavigationTarget("pickup")}
                      >
                        <span>Drive to pickup</span>
                        <span className="text-xs font-bold opacity-80">Choose Google Maps or Waze</span>
                      </button>
                    )}

                    {currentTrip.status === "ongoing" && (dropoffGoogle || dropoffWaze) && (
                      <button
                        type="button"
                        className="moovu-driver-nav-button"
                        onClick={() => setNavigationTarget("dropoff")}
                      >
                        <span>Drive to destination</span>
                        <span className="text-xs font-bold opacity-80">Choose Google Maps or Waze</span>
                      </button>
                    )}

                    {canOpenTripChat && (
                      <div className="rounded-[22px] border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
                        Chat is open for this trip. Use the floating chat button.
                      </div>
                    )}
                  </div>

                  <div className="mt-5">
                    {currentTrip.status === "assigned" && (
                      <button
                        className="moovu-btn moovu-btn-primary"
                        disabled={busy}
                        onClick={() => arriveTrip(currentTrip.id)}
                      >
                        Mark as arrived
                      </button>
                    )}

                    {currentTrip.status === "arrived" && (
                      <div className="moovu-driver-otp-card">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="moovu-section-title">Start trip</div>
                            <div className="mt-1 text-xl font-black text-slate-950">
                              Passenger start OTP
                            </div>
                            <p className="mt-1 text-sm leading-6 text-slate-600">
                              Ask the customer for the start code before moving the trip to active.
                            </p>
                          </div>
                          <span className="moovu-chip moovu-chip-warning">OTP required</span>
                        </div>

                        {!showStartOtp ? (
                          <button
                            onClick={() => setShowStartOtp(true)}
                            disabled={busy}
                            className="moovu-btn moovu-btn-primary mt-4 w-full sm:w-auto"
                          >
                            Enter start OTP
                          </button>
                        ) : (
                          <div className="mt-4 max-w-md space-y-3">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={4}
                              value={startOtp}
                              onChange={(e) => setStartOtp(e.target.value.replace(/\D/g, "").slice(0, 4))}
                              placeholder="0000"
                              className="moovu-otp-input"
                            />

                            <div className="grid gap-3 sm:grid-cols-2">
                              <button
                                onClick={async () => {
                                  await startTrip(currentTrip.id, startOtp);
                                  setStartOtp("");
                                  setShowStartOtp(false);
                                }}
                                disabled={busy || startOtp.trim().length < 4}
                                className="moovu-btn moovu-btn-primary w-full"
                              >
                                {busy ? "Checking..." : "Verify and start"}
                              </button>

                              <button
                                onClick={() => {
                                  setStartOtp("");
                                  setShowStartOtp(false);
                                }}
                                disabled={busy}
                                className="moovu-btn moovu-btn-secondary w-full"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                          {noShowSecondsLeft == null ? (
                            "No-show timer starts after the arrival event is recorded."
                          ) : noShowSecondsLeft > 0 ? (
                            `Customer no-show can be marked in ${Math.ceil(noShowSecondsLeft / 60)} min.`
                          ) : (
                            <div className="space-y-3">
                              <p className="font-semibold">
                                Customer no-show is now eligible. No-show fee: R{currentNoShowFee.feeAmount}. Driver payout: R{currentNoShowFee.driverAmount}.
                              </p>
                              <button
                                type="button"
                                className="moovu-btn bg-amber-600 text-white disabled:opacity-60"
                                disabled={busy}
                                onClick={() => markNoShow(currentTrip.id)}
                              >
                                Mark customer no-show
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {currentTrip.status === "ongoing" && (
                      <div className="moovu-driver-otp-card is-complete">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="moovu-section-title">Complete trip</div>
                            <div className="mt-1 text-xl font-black text-slate-950">
                              Passenger end OTP
                            </div>
                            <p className="mt-1 text-sm leading-6 text-slate-600">
                              Confirm the customer end code before closing this ride.
                            </p>
                          </div>
                          <span className="moovu-chip moovu-chip-success">Ready to finish</span>
                        </div>

                        {!showEndOtp ? (
                          <button
                            onClick={() => setShowEndOtp(true)}
                            disabled={busy}
                            className="moovu-btn moovu-btn-primary mt-4 w-full sm:w-auto"
                          >
                            Enter end OTP
                          </button>
                        ) : (
                          <div className="mt-4 max-w-md space-y-3">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={4}
                              value={endOtp}
                              onChange={(e) => setEndOtp(e.target.value.replace(/\D/g, "").slice(0, 4))}
                              placeholder="0000"
                              className="moovu-otp-input"
                            />

                            <div className="grid gap-3 sm:grid-cols-2">
                              <button
                                onClick={async () => {
                                  await completeTrip(currentTrip.id, endOtp);
                                  setEndOtp("");
                                  setShowEndOtp(false);
                                }}
                                disabled={busy || endOtp.trim().length < 4}
                                className="moovu-btn w-full bg-emerald-600 text-white disabled:opacity-60"
                              >
                                {busy ? "Checking..." : "Verify and complete"}
                              </button>

                              <button
                                onClick={() => {
                                  setEndOtp("");
                                  setShowEndOtp(false);
                                }}
                                disabled={busy}
                                className="moovu-btn moovu-btn-secondary w-full"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            <aside className="space-y-4">
              <section className="moovu-card-interactive p-5">
                <div className="text-sm font-medium text-slate-500">Location tools</div>

                <div className="mt-4 space-y-3">
                  <input
                    className="moovu-input"
                    placeholder="Update location manually"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                  />

                  <div className="flex flex-wrap gap-3">
                    <button
                      className="moovu-btn moovu-btn-secondary"
                      disabled={busy}
                      onClick={saveLocationFromName}
                    >
                      Save manual location
                    </button>

                    <button
                      className="moovu-btn moovu-btn-primary"
                      disabled={busy}
                      onClick={() => void retryCurrentGps()}
                    >
                      Save current GPS
                    </button>
                  </div>
                </div>
              </section>

              <section className="moovu-card-interactive p-5">
                <div className="text-sm font-medium text-slate-500">Quick links</div>

                <div className="mt-4 grid gap-3">
                  <button
                    className="moovu-btn moovu-btn-secondary justify-start"
                    onClick={() => router.push("/driver/earnings")}
                  >
                    View earnings
                  </button>

                  <button
                    className="moovu-btn moovu-btn-secondary justify-start"
                    onClick={() => router.push("/driver/commission-payments")}
                  >
                    Pay MOOVU commission
                  </button>

                  <button
                    className="moovu-btn moovu-btn-secondary justify-start"
                    onClick={() => router.push("/driver/history")}
                  >
                    Trip history
                  </button>
                </div>
              </section>

              <section className="moovu-card-interactive p-5">
                <div className="text-sm font-medium text-slate-500">Safety and support</div>
                <div className="mt-3 rounded-2xl bg-blue-50 p-4 text-sm font-semibold leading-6 text-blue-800">
                  MOOVU keeps trips visible with customer contact, OTP trip starts, live route updates, and support tools.
                </div>
                <div className="mt-4 grid gap-3">
                  <button
                    type="button"
                    className="moovu-btn moovu-btn-secondary justify-start"
                    onClick={() => setInfo("Share trip is coming soon for drivers.")}
                  >
                    Share trip
                  </button>
                  <button
                    type="button"
                    className="moovu-btn moovu-btn-secondary justify-start"
                    onClick={() => showDriverActionError("Emergency support is coming soon. For urgent danger, contact local emergency services immediately.")}
                  >
                    Emergency support
                  </button>
                  <button
                    type="button"
                    className="moovu-btn moovu-btn-secondary justify-start"
                    onClick={() => router.push("/driver/contact")}
                  >
                    Help centre
                  </button>
                </div>
              </section>

              <section id="driver-trip-offer-card" className={`moovu-driver-offer-card p-5 ${offer ? "has-offer" : ""}`}>
                <div className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">
                  Trip offers
                </div>

                {!offer ? (
                  <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                    Stay online to receive nearby trip requests.
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-sm font-bold leading-6 text-blue-800">
                    New request is open at the top of the app. Respond before the timer ends.
                  </div>
                )}
              </section>
            </aside>
          </div>
        )}
      </div>

      {currentTrip && canOpenTripChat && (
        <div className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-4 z-[8000]">
          <TripChatPanel
            tripId={currentTrip.id}
            label="Chat with customer"
            buttonClassName="moovu-floating-chat-button"
            initialOpen={
              shouldOpenChatFromNotification &&
              (!notificationTripId || notificationTripId === currentTrip.id)
            }
          />
        </div>
      )}

      <DriverBottomNav />
    </main>
  );
}

