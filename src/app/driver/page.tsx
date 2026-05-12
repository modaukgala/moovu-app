"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import EnableNotificationsButton from "@/components/EnableNotificationsButton";
import TripChatPanel from "@/components/trip-chat/TripChatPanel";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { getMoovuCurrentPosition } from "@/lib/native-permissions";
import { supabaseClient } from "@/lib/supabase/client";

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
  created_at: string | null;
  driver_arrived_at?: string | null;
  no_show_eligible_at?: string | null;
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

export default function DriverHomePage() {
  const router = useRouter();

  const [driver, setDriver] = useState<Driver | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [currentTrip, setCurrentTrip] = useState<CurrentTrip | null>(null);

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

  const otpEntryOpen = showStartOtp || showEndOtp;
  const canOpenTripChat =
    !!currentTrip?.driver_id &&
    ["assigned", "arrived", "ongoing"].includes(currentTrip.status);

  const offersTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tripTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsPermissionBlockedRef = useRef(false);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const mapInitializedRef = useRef(false);
  const mapContainerNodeRef = useRef<HTMLDivElement | null>(null);

  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
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

    setGpsInfo(`GPS live • ${new Date().toLocaleTimeString()}`);
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
    await loadCurrentOffer();
    await loadCurrentTrip();
    await loadDriverProfile(true);
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
    await loadCurrentTrip();
    await loadDriverProfile(true);
  }

  async function arriveTrip(tripId: string) {
    await tripAction("/api/driver/trips/arrive", { tripId }, "Marked as arrived ✅");
  }

  async function startTrip(tripId: string, otp: string) {
    await tripAction("/api/driver/trips/start", { tripId, otp }, "Trip started ✅");
  }

  async function completeTrip(tripId: string, otp: string) {
    await tripAction("/api/driver/trips/complete", { tripId, otp }, "Trip completed ✅");
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

    driverMarkerRef.current = null;
    pickupMarkerRef.current = null;
    dropoffMarkerRef.current = null;
    directionsRendererRef.current = null;
  }

  function updateMapObjects() {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps || !driver) return;

    clearMapLayers();
    const routePreview = currentTrip ?? offer;

    const bounds = new window.google.maps.LatLngBounds();
    let hasAnyPoint = false;

    if (typeof driver.lat === "number" && typeof driver.lng === "number") {
      const driverPos = { lat: driver.lat, lng: driver.lng };
      driverMarkerRef.current = new window.google.maps.Marker({
        map,
        position: driverPos,
        title: "You",
        label: "Y",
      });
      bounds.extend(driverPos);
      hasAnyPoint = true;
    }

    if (routePreview?.pickup_lat != null && routePreview?.pickup_lng != null) {
      const pickupPos = { lat: routePreview.pickup_lat, lng: routePreview.pickup_lng };
      pickupMarkerRef.current = new window.google.maps.Marker({
        map,
        position: pickupPos,
        title: "Pickup",
        label: "P",
      });
      bounds.extend(pickupPos);
      hasAnyPoint = true;
    }

    if (routePreview?.dropoff_lat != null && routePreview?.dropoff_lng != null) {
      const dropoffPos = { lat: routePreview.dropoff_lat, lng: routePreview.dropoff_lng };
      dropoffMarkerRef.current = new window.google.maps.Marker({
        map,
        position: dropoffPos,
        title: "Dropoff",
        label: "D",
      });
      bounds.extend(dropoffPos);
      hasAnyPoint = true;
    }

    if (hasAnyPoint && !bounds.isEmpty()) {
      map.fitBounds(bounds);
      window.setTimeout(() => {
        const zoom = map.getZoom();
        if (zoom && zoom > 15) map.setZoom(15);
      }, 250);
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
      const directionsRenderer = new window.google.maps.DirectionsRenderer({
        suppressMarkers: true,
        preserveViewport: true,
      });

      directionsRenderer.setMap(map);
      directionsRendererRef.current = directionsRenderer;

      directionsService.route(
        {
          origin: { lat: driver.lat!, lng: driver.lng! },
          destination: { lat: destLat, lng: destLng },
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

      <div className="moovu-shell">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="moovu-section-title">MOOVU Driver</div>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">
              Driver dashboard
            </h1>
            <p className="mt-2 text-sm font-medium text-slate-600">
              Manage availability, GPS, offers, and active trips from one screen.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <EnableNotificationsButton role="driver" variant="inline" />
            <button className="moovu-btn moovu-btn-secondary" onClick={logout}>
              Logout
            </button>
          </div>
        </div>

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
          <div className="grid gap-4 xl:grid-cols-[1.22fr_0.78fr]">
            <section className="space-y-4">
              <div className={`moovu-driver-cockpit p-5 ${driver.online ? "is-online" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="moovu-section-title">Availability</div>
                    <div className="mt-1 text-4xl font-black tracking-tight text-slate-950">
                      {driver.online ? "Online" : "Offline"}
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      {driver.first_name ?? "--"} {driver.last_name ?? ""} · {driver.phone ?? "--"}
                    </div>
                  </div>

                  <div className={driver.online ? "moovu-chip moovu-chip-success" : "moovu-chip"}>
                    <span className="moovu-chip-dot" />
                    {driver.online ? "Ready for trips" : "Not receiving trips"}
                  </div>
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                    <span>Driver rhythm</span>
                    <span>{currentTrip ? tripStatusLabel(currentTrip.status) : offer ? "Offer pending" : "Standby"}</span>
                  </div>
                  <div className="moovu-driver-rhythm" aria-hidden="true">
                    <span className={`moovu-driver-rhythm-step ${driver.online ? "is-active" : ""}`} />
                    <span className={`moovu-driver-rhythm-step ${offer || currentTrip ? "is-active" : ""}`} />
                    <span className={`moovu-driver-rhythm-step ${currentTrip?.status === "arrived" || currentTrip?.status === "ongoing" ? "is-active" : ""}`} />
                    <span className={`moovu-driver-rhythm-step ${currentTrip?.status === "ongoing" ? "is-active" : ""}`} />
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Approval</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{driver.status ?? "--"}</div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Verification</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {driver.verification_status ?? "--"}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Subscription</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {driver.subscription_status ?? "--"}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Busy</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {driver.busy ? "Yes" : "No"}
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <button
                    className="moovu-driver-toggle-on"
                    disabled={busy}
                    onClick={() => setOnlineServer(true)}
                  >
                    Go online
                  </button>

                  <button
                    className="moovu-driver-toggle-off"
                    disabled={busy}
                    onClick={() => setOnlineServer(false)}
                  >
                    Go offline
                  </button>

                  <button
                    className="moovu-btn moovu-btn-secondary"
                    onClick={() => router.push("/driver/complete-profile")}
                  >
                    {driver.profile_completed ? "Edit application" : "Complete application"}
                  </button>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-[34px] border border-[var(--moovu-border)] bg-white shadow-md">
                <div className="absolute left-4 top-4 z-10 rounded-full bg-white/95 px-4 py-2 text-sm font-medium text-slate-700 shadow">
                  {currentTrip ? tripStatusLabel(currentTrip.status) : offer ? "New trip offer" : "Waiting for request"}
                </div>

                {mapError ? (
                  <div className="flex h-[58vh] items-center justify-center bg-slate-50 p-6 text-sm text-slate-700">
                    {mapError}
                  </div>
                ) : (
                  <div ref={mapRef} className="h-[58vh] w-full bg-slate-100" />
                )}

                <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-white via-white/95 to-white/65 p-4 md:p-5">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="moovu-stat-card">
                      <div className="moovu-stat-label">Current GPS</div>
                      <div className="mt-2 text-sm font-medium text-slate-900">
                        {driver.lat != null && driver.lng != null
                          ? `${driver.lat}, ${driver.lng}`
                          : "—"}
                      </div>
                    </div>

                    <div className="moovu-stat-card">
                      <div className="moovu-stat-label">Last seen</div>
                      <div className="mt-2 text-sm font-medium text-slate-900">
                        {driver.last_seen ? new Date(driver.last_seen).toLocaleString() : "—"}
                      </div>
                    </div>

                    <div className="moovu-stat-card moovu-stat-card-primary">
                      <div className="moovu-stat-label">Navigation mode</div>
                      <div className="moovu-stat-value">
                        {currentTrip ? "Trip active" : offer ? "Offer pending" : "Standby"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {currentTrip && (
                <div className="moovu-driver-active-trip p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-500">Active trip</div>
                      <div className="mt-1 text-2xl font-semibold text-slate-950">
                        {tripStatusLabel(currentTrip.status)}
                      </div>
                    </div>

                    <div className="moovu-chip moovu-chip-primary">
                      <span className="moovu-chip-dot" />
                      Fare: R{currentTrip.fare_amount ?? "—"}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl bg-[var(--moovu-primary-soft)] p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Pickup</div>
                      <div className="mt-1 text-sm font-medium text-slate-900">
                        {currentTrip.pickup_address ?? "—"}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Dropoff</div>
                      <div className="mt-1 text-sm font-medium text-slate-900">
                        {currentTrip.dropoff_address ?? "—"}
                      </div>
                    </div>
                  </div>

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
                                Customer no-show is now eligible. No-show fee: R30. Driver payout: R22.
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

              <section className={`moovu-driver-offer-card p-5 ${offer ? "has-offer" : ""}`}>
                <div className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">
                  Trip offers
                </div>

                {!offer ? (
                  <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                    Stay online to receive nearby trip requests.
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-[28px] border border-[var(--moovu-border)] bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">
                            New request
                          </div>
                          <div className="mt-1 text-xl font-semibold text-slate-950">
                            R{offer.fare_amount ?? "—"}
                          </div>
                        </div>

                        <div className="moovu-chip">
                          <span className="moovu-chip-dot" />
                          {secondsLeft != null ? `${secondsLeft}s left` : "—"}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3">
                        <div className="rounded-2xl bg-white p-3">
                          <div className="text-xs text-slate-500">Pickup</div>
                          <div className="mt-1 text-sm font-medium text-slate-900">
                            {offer.pickup_address ?? "—"}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white p-3">
                          <div className="text-xs text-slate-500">Dropoff</div>
                          <div className="mt-1 text-sm font-medium text-slate-900">
                            {offer.dropoff_address ?? "—"}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-2xl bg-white p-3">
                            <div className="text-xs text-slate-500">Payment</div>
                            <div className="mt-1 text-sm font-medium text-slate-900">
                              {offer.payment_method ?? "—"}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-white p-3">
                            <div className="text-xs text-slate-500">Offer status</div>
                            <div className="mt-1 text-sm font-medium text-slate-900">
                              {offer.offer_status}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-white p-3">
                            <div className="text-xs text-slate-500">Distance</div>
                            <div className="mt-1 text-sm font-medium text-slate-900">
                              {offer.distance_km == null ? "—" : `${Number(offer.distance_km).toFixed(1)} km`}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-white p-3">
                            <div className="text-xs text-slate-500">Duration</div>
                            <div className="mt-1 text-sm font-medium text-slate-900">
                              {offer.duration_min == null ? "—" : `${Math.round(Number(offer.duration_min))} min`}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        className="moovu-driver-accept"
                        disabled={busy || secondsLeft === 0}
                        onClick={() => respondToOffer("accept")}
                      >
                        Accept trip
                      </button>

                      <button
                        className="moovu-driver-decline"
                        disabled={busy || secondsLeft === 0}
                        onClick={() => respondToOffer("reject")}
                      >
                        Decline
                      </button>
                    </div>
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
          />
        </div>
      )}

      <DriverBottomNav />
    </main>
  );
}
