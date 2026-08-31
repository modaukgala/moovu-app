"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReliableRead, useReadLoop } from "@/hooks/useReliableRead";
import { READ_POLICIES, readFailure, pollDelay } from "@/lib/reliability/readPolling";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CarFront,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Headphones,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import DriverDrawer from "@/components/driver/home/DriverDrawer";
import DriverMapSurface from "@/components/driver/home/DriverMapSurface";
import { EndOtpBypassDialog, SubscriptionRequiredDialog, TripCompletionOverlay } from "@/components/driver/home/DriverDialogs";
import FloatingCustomerChat from "@/components/driver/home/FloatingCustomerChat";
import NavigationChooser from "@/components/driver/home/NavigationChooser";
import TripOfferPanel from "@/components/driver/home/TripOfferPanel";
import { getNoShowFee } from "@/lib/finance/cancellationFees";
import {
  DRIVER_COMMISSION_LOCK_LIMIT,
  DRIVER_COMMISSION_WARNING_RATIO,
} from "@/lib/finance/commission";
import { notifyInApp } from "@/lib/in-app-notifications";
import {
  carMarkerIcon,
  createOrMoveMarker,
  fitBoundsToPoints,
  gpsMarkerIcon,
  makeRouteRenderer,
  stopMarkerIcon,
} from "@/lib/maps/liveMapMarkers";
import { LIVE_LOCATION_CONFIG } from "@/lib/location/liveLocationConfig";
import { getMoovuCurrentPosition } from "@/lib/native-permissions";
import { supabaseClient } from "@/lib/supabase/client";
import { getDriverLevel } from "@/lib/trust/driverLevels";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import type { CompletedFareSummary, CurrentTrip, Driver, DriverEarningsSnapshot, DriverEarningsTrip, GpsNotice, Offer, TripActionResponse } from "@/components/driver/home/types";
import {
  canReceiveTripOffers,
  DEFAULT_CENTER,
  DRIVER_CANCEL_REASONS,
  END_OTP_BYPASS_REASONS,
  friendlyGeolocationError,
  googleMapsLink,
  gpsNoticeClass,
  gpsNoticeMessage,
  gpsNoticeTone,
  money,
  num,
  parseTripStops,
  rideTypeLabel,
  tripStatusLabel,
  wazeLink,
} from "@/components/driver/home/utils";


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
  const [offerResponding, setOfferResponding] = useState<"accept" | "reject" | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [driverActionError, setDriverActionError] = useState<string | null>(null);
  const [gpsInfo, setGpsInfo] = useState<GpsNotice | string | null>(null);
  const [loadingDriver, setLoadingDriver] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [mapError, setMapError] = useState<string | null>(null);
  const [satelliteMap, setSatelliteMap] = useState(false);

  const [startOtp, setStartOtp] = useState("");
  const [showStartOtp, setShowStartOtp] = useState(false);
  const [endOtp, setEndOtp] = useState("");
  const [showEndOtp, setShowEndOtp] = useState(false);
  const [showEndOtpBypass, setShowEndOtpBypass] = useState(false);
  const [endOtpBypassReason, setEndOtpBypassReason] = useState<string>(END_OTP_BYPASS_REASONS[0]);
  const [endOtpBypassNote, setEndOtpBypassNote] = useState("");
  const [navigationTarget, setNavigationTarget] = useState<"pickup" | "dropoff" | null>(null);
  const [driverToolsOpen, setDriverToolsOpen] = useState(false);
  const [tripSheetOpen, setTripSheetOpen] = useState(false);
  const [showCancelTripForm, setShowCancelTripForm] = useState(false);
  const [cancelTripReason, setCancelTripReason] = useState<string>(DRIVER_CANCEL_REASONS[0]);
  const [completedFareSummary, setCompletedFareSummary] = useState<CompletedFareSummary | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [subscriptionPromptOpen, setSubscriptionPromptOpen] = useState(false);
  const [driverRealtimeConnected, setDriverRealtimeConnected] = useState(false);
  const completionRequestRef = useRef(false);
  const isPageVisible = usePageVisibility();
  const offerRead = useReliableRead(READ_POLICIES.driverOffers, "driver-offers", driverRealtimeConnected);
  const tripRead = useReliableRead(READ_POLICIES.driverTrip, "driver-trip", driverRealtimeConnected);

  const subscriptionAllowsOnline = canReceiveTripOffers(driver);
  const driverLevel = getDriverLevel(earningsSnapshot.completedTrips);
  const otpEntryOpen = showStartOtp || showEndOtp || showEndOtpBypass;
  const canOpenTripChat =
    !!currentTrip?.driver_id &&
    ["assigned", "arrived", "ongoing"].includes(currentTrip.status);
  const shouldOpenChatFromNotification = searchParams.get("chat") === "1";
  const notificationTripId = searchParams.get("tripId") || searchParams.get("offerTripId") || "";
  const gpsTone = gpsInfo ? gpsNoticeTone(gpsInfo) : null;
  const gpsAttentionNotice = gpsInfo && gpsTone !== "success" ? gpsInfo : null;

  useEffect(() => {
    if (!currentTrip) setTripSheetOpen(false);
  }, [currentTrip]);

  useEffect(() => {
    if (!driver || subscriptionAllowsOnline) return;
    if (currentTrip && ["assigned", "arrived", "ongoing"].includes(currentTrip.status)) return;

    const key = `moovu-subscription-reminder:${driver.id}:${driver.subscription_status ?? "inactive"}:${driver.subscription_expires_at ?? "none"}`;
    if (window.sessionStorage.getItem(key)) return;

    window.sessionStorage.setItem(key, "shown");
    setSubscriptionPromptOpen(true);
  }, [currentTrip, driver, subscriptionAllowsOnline]);

  const gpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsCaptureRef = useRef<Promise<boolean> | null>(null);
  const heartbeatRef = useRef<Promise<boolean> | null>(null);
  const heartbeatFailureRef = useRef({ failures: 0, retryAt: 0 });
  const gpsPermissionBlockedRef = useRef(false);
  const lastNotifiedOfferIdRef = useRef<string | null>(null);
  const lastHeartbeatSentRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const lastRouteRenderRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });

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

  const safeGetSession = useCallback(async () => {
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
  }, []);

  const getAccessToken = useCallback(async () => {
    const session = await safeGetSession();
    return session?.access_token ?? null;
  }, [safeGetSession]);

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

  const loadCurrentOffer = useCallback(() => offerRead.run(async (signal) => {
    const token = await getAccessToken();
    if (!token) return readFailure(401);

    const res = await fetch("/api/driver/offers/current", {
      signal,
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);
    signal.throwIfAborted();
    if (!res.ok || !json?.ok) return readFailure(res.status);

    setOffer(json.offer ?? null);
  }), [getAccessToken, offerRead]);

  const loadCurrentTrip = useCallback(() => tripRead.run(async (signal) => {
    const token = await getAccessToken();
    if (!token) return readFailure(401);

    const res = await fetch("/api/driver/current-trip", {
      signal,
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);
    signal.throwIfAborted();
    if (!res.ok || !json?.ok) return readFailure(res.status);

    setCurrentTrip(json.trip ?? null);
  }), [getAccessToken, tripRead]);

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

    if (wantOnline && !subscriptionAllowsOnline) {
      showDriverActionError("Your subscription must be active before you can go online and receive trip offers.");
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

  async function sendHeartbeat(
    lat: number,
    lng: number,
    telemetry?: { heading?: number | null; speedMps?: number | null; accuracyM?: number | null },
  ) {
    if (heartbeatRef.current) return heartbeatRef.current;
    if (Date.now() < heartbeatFailureRef.current.retryAt) return false;
    const started = Date.now();
    heartbeatRef.current = (async () => {
    const token = await getAccessToken();
    if (!token) return false;

    const res = await fetch("/api/driver/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        lat,
        lng,
        heading: telemetry?.heading ?? null,
        speedMps: telemetry?.speedMps ?? null,
        accuracyM: telemetry?.accuracyM ?? null,
        capturedAt: new Date().toISOString(),
      }),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setGpsInfo({
        tone: "danger",
        message: json?.error || "GPS heartbeat failed. Try refreshing your location.",
      });
      return false;
    }

    setGpsInfo({
      tone: "success",
      message: `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    });
    return true;
    })().catch(() => false).then((ok) => {
      const previousFailures = heartbeatFailureRef.current.failures;
      const failures = ok ? 0 : previousFailures + 1;
      const delayMs = ok ? 0 : pollDelay(READ_POLICIES.location, failures, true);
      heartbeatFailureRef.current = { failures, retryAt: Date.now() + delayMs };
      if (!ok || previousFailures > 0) console.info("[heartbeat-reliability]", {
        operation: "driver-heartbeat", failures, recovered: ok && previousFailures > 0,
        durationMs: Date.now() - started, backoffMs: delayMs,
      });
      return ok;
    }).finally(() => { heartbeatRef.current = null; });
    return heartbeatRef.current;
  }

  async function captureCurrentLocationAndSave(silent = false, refreshProfile = true) {
    if (gpsCaptureRef.current) return gpsCaptureRef.current;
    gpsCaptureRef.current = new Promise<boolean>((resolve) => {
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
          const extendedCoords = pos.coords as typeof pos.coords & { heading?: number | null; speed?: number | null };
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setDriver((current) => current ? {
            ...current,
            lat,
            lng,
            last_seen: new Date().toISOString(),
          } : current);

          const activeTrip = currentTrip && ["assigned", "arrived", "ongoing"].includes(currentTrip.status);
          const previous = lastHeartbeatSentRef.current;
          const now = Date.now();
          const movedEnough = !previous ||
            Math.abs(previous.lat - lat) + Math.abs(previous.lng - lng) >= 0.00005;
          const activeTripHeartbeatDue =
            !previous || now - previous.at >= LIVE_LOCATION_CONFIG.driverActiveHeartbeatMs;
          const movingHeartbeatDue =
            !previous || now - previous.at >= LIVE_LOCATION_CONFIG.driverMovingHeartbeatMs;
          const idleHeartbeatDue =
            !previous || now - previous.at >= LIVE_LOCATION_CONFIG.idleHeartbeatMs;
          let ok = true;
          const shouldSendHeartbeat = activeTrip
            ? activeTripHeartbeatDue
            : movedEnough
              ? movingHeartbeatDue
              : idleHeartbeatDue;
          if (shouldSendHeartbeat) {
            ok = await sendHeartbeat(lat, lng, {
              heading: extendedCoords.heading,
              speedMps: extendedCoords.speed,
              accuracyM: pos.coords.accuracy,
            });
            if (ok) lastHeartbeatSentRef.current = { lat, lng, at: Date.now() };
          }
          if (refreshProfile) await loadDriverProfile(silent);
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
      ).catch(() => resolve(false));
    }).finally(() => { gpsCaptureRef.current = null; });
    return gpsCaptureRef.current;
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
    if (!offer || offerResponding) return;

    window.dispatchEvent(new Event("moovu:stop-trip-offer-alert"));
    setOfferResponding(action);
    setInfo(null);
    setDriverActionError(null);

    const token = await getAccessToken();
    if (!token) {
      setOfferResponding(null);
      return;
    }

    try {
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

      if (!res.ok || !json?.ok) {
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
    } catch (error: unknown) {
      console.error("[driver-offers] response failed", error);
      showDriverActionError("Could not respond to this offer. Please check your connection and try again.");
    } finally {
      setOfferResponding(null);
    }
  }

  async function tripAction(
    endpoint: string,
    payload: Record<string, unknown>,
    successMsg: string
  ) {
    setBusy(true);
    setInfo(null);
    setDriverActionError(null);

    try {
      const token = await getAccessToken();
      if (!token) return null;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null) as TripActionResponse | null;

      if (!res.ok || !json?.ok) {
        showDriverActionError(json?.error || "Action failed. Please try again.");
        await loadCurrentTrip();
        await loadDriverProfile(true);
        return null;
      }

      const completedWithoutOtp =
        endpoint.includes("/complete") && payload.completionMode === "bypass";
      setInfo(successMsg);
      notifyInApp({
        title: successMsg,
        body: endpoint.includes("/start")
          ? "Start OTP verified. The trip is now active."
          : completedWithoutOtp
            ? "The trip was completed without the End OTP."
            : endpoint.includes("/complete")
              ? "End OTP verified. The trip has been completed."
              : endpoint.includes("/cancel")
                ? "MOOVU cancelled this trip and updated the customer."
                : "MOOVU saved this trip update.",
        tone: endpoint.includes("/complete") || endpoint.includes("/start") ? "success" : "info",
        loud: endpoint.includes("/start") || endpoint.includes("/complete"),
      });
      await loadCurrentTrip();
      await loadDriverProfile(true);
      await loadEarningsSnapshot();
      return json;
    } catch (error: unknown) {
      console.error("[driver-trip-action] request failed", { endpoint, error });
      showDriverActionError("Could not update this trip. Check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function arriveTrip(tripId: string) {
    await tripAction("/api/driver/trips/arrive", { tripId }, "Marked as arrived âœ…");
  }

  async function startTrip(tripId: string, otp: string) {
    await tripAction("/api/driver/trips/start", { tripId, otp }, "Trip started âœ…");
  }

  async function completeTrip(
    tripId: string,
    options: { otp?: string; completionMode?: "otp" | "bypass"; bypassReason?: string; bypassNote?: string },
  ) {
    if (completionRequestRef.current) return null;
    completionRequestRef.current = true;

    try {
      const result = await tripAction(
        "/api/driver/trips/complete",
        { tripId, ...options },
        "Trip completed",
      );
      if (result?.ok && result.fare?.finalFare != null) {
        setCompletedFareSummary({
          tripId,
          finalFare: Number(result.fare.finalFare),
          driverNet: Number(result.commission?.driverNet ?? 0),
          commissionAmount: Number(result.commission?.commissionAmount ?? 0),
        });
        setShowEndOtp(false);
        setShowEndOtpBypass(false);
        setEndOtp("");
        setEndOtpBypassReason(END_OTP_BYPASS_REASONS[0]);
        setEndOtpBypassNote("");
      }
      return result;
    } finally {
      completionRequestRef.current = false;
    }
  }

  async function confirmPaymentReceived() {
    if (!completedFareSummary || confirmingPayment) return;
    setConfirmingPayment(true);
    const token = await getAccessToken();
    if (!token) {
      setConfirmingPayment(false);
      return;
    }

    try {
      const response = await fetch("/api/driver/trips/payment-received", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tripId: completedFareSummary.tripId }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        showDriverActionError(json?.error || "Could not confirm payment receipt.");
        return;
      }
      notifyInApp({
        title: "Payment received",
        body: `R${completedFareSummary.finalFare.toFixed(2)} marked as received.`,
        tone: "success",
      });
      setCompletedFareSummary(null);
    } catch (error: unknown) {
      console.error("[driver-payment-received] request failed", error);
      showDriverActionError("Could not confirm payment receipt. Please try again.");
    } finally {
      setConfirmingPayment(false);
    }
  }

  async function cancelCurrentTrip(tripId: string, reason: string) {
    await tripAction("/api/driver/trips/cancel", { tripId, reason }, "Trip cancelled.");
    setShowCancelTripForm(false);
    setCancelTripReason(DRIVER_CANCEL_REASONS[0]);
  }

  async function markNoShow(tripId: string) {
    await tripAction(
      "/api/driver/trips/no-show",
      { tripId },
      "Customer no-show recorded."
    );
  }

  function clearMapLayers(preserveDriver = false) {
    if (!preserveDriver && driverMarkerRef.current) driverMarkerRef.current.setMap(null);
    if (pickupMarkerRef.current) pickupMarkerRef.current.setMap(null);
    if (dropoffMarkerRef.current) dropoffMarkerRef.current.setMap(null);
    if (directionsRendererRef.current) directionsRendererRef.current.setMap(null);
    stopMarkerRefs.current.forEach((marker) => marker.setMap(null));

    if (!preserveDriver) driverMarkerRef.current = null;
    pickupMarkerRef.current = null;
    dropoffMarkerRef.current = null;
    directionsRendererRef.current = null;
    stopMarkerRefs.current = [];
  }

  function updateMapObjects() {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps || !driver) return;

    const routePreview = currentTrip ?? offer;
    const routeStops = parseTripStops(routePreview?.stops);

    if (typeof driver.lat === "number" && typeof driver.lng === "number") {
      const driverPos = { lat: driver.lat, lng: driver.lng };
      driverMarkerRef.current = createOrMoveMarker({
        map,
        marker: driverMarkerRef.current,
        position: driverPos,
        title: "You",
        icon: currentTrip || offer ? carMarkerIcon() : gpsMarkerIcon(),
      });
    }

    const routeKey = [
      routePreview?.id ?? "idle",
      routePreview?.status ?? "none",
      routePreview?.pickup_lat ?? "",
      routePreview?.pickup_lng ?? "",
      routePreview?.dropoff_lat ?? "",
      routePreview?.dropoff_lng ?? "",
      routeStops.map((stop) => `${stop.lat}:${stop.lng}`).join("|"),
      driver.lat != null && driver.lng != null ? "origin-ready" : "origin-missing",
    ].join(":");
    if (lastRouteRenderRef.current.key === routeKey) {
      return;
    }
    lastRouteRenderRef.current = { key: routeKey, at: Date.now() };
    clearMapLayers(true);

    const points: google.maps.LatLngLiteral[] = [];
    if (typeof driver.lat === "number" && typeof driver.lng === "number") {
      points.push({ lat: driver.lat, lng: driver.lng });
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

  useReadLoop(offerRead, loadCurrentOffer, Boolean(driver?.online), false);
  useReadLoop(tripRead, loadCurrentTrip, Boolean(driver?.online) && !otpEntryOpen, false);

  useEffect(() => {
    if (searchParams.get("offerExpired") !== "1") return;
    setInfo("This trip is no longer available.");
  }, [searchParams]);

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
    const hasActiveTrip = ["assigned", "arrived", "ongoing"].includes(String(currentTrip?.status ?? ""));
    const sampleMs = isPageVisible
      ? LIVE_LOCATION_CONFIG.driverSampleMs
      : hasActiveTrip
        ? LIVE_LOCATION_CONFIG.driverMovingHeartbeatMs
        : LIVE_LOCATION_CONFIG.idleHeartbeatMs;

    gpsTimerRef.current = setInterval(() => {
      captureCurrentLocationAndSave(true, false);
    }, sampleMs);

    return () => {
      if (gpsTimerRef.current) clearInterval(gpsTimerRef.current);
    };
    // GPS polling intentionally starts/stops only with online state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.online, currentTrip?.id, currentTrip?.status, isPageVisible]);

  useEffect(() => {
    if (!driver?.id) return;

    const channel = supabaseClient
      .channel(`driver-live-${driver.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "driver_trip_offers",
          filter: `driver_id=eq.${driver.id}`,
        },
        () => {
          void loadCurrentOffer();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trips",
          filter: `driver_id=eq.${driver.id}`,
        },
        () => {
          void loadCurrentTrip();
          void loadCurrentOffer();
        },
      )
      .subscribe((status) => {
        setDriverRealtimeConnected(status === "SUBSCRIBED");
      });

    return () => {
      setDriverRealtimeConnected(false);
      void supabaseClient.removeChannel(channel);
    };
    // The driver id is the stable channel key; callbacks read the latest auth state when invoked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.id]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY
      || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      || "";
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
  const pickupInstruction =
    typeof currentTrip?.fare_breakdown?.pickupInstruction === "string"
      ? currentTrip.fare_breakdown.pickupInstruction.trim()
      : "";
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

      <SubscriptionRequiredDialog
        open={subscriptionPromptOpen}
        onClose={() => setSubscriptionPromptOpen(false)}
        onChoosePlan={() => router.push("/driver/subscriptions")}
      />
      <EndOtpBypassDialog
        open={showEndOtpBypass}
        trip={currentTrip}
        reason={endOtpBypassReason}
        note={endOtpBypassNote}
        busy={busy}
        onReasonChange={setEndOtpBypassReason}
        onNoteChange={setEndOtpBypassNote}
        onCancel={() => {
          setShowEndOtpBypass(false);
          setEndOtpBypassReason(END_OTP_BYPASS_REASONS[0]);
          setEndOtpBypassNote("");
        }}
        onConfirm={() => {
          if (!currentTrip?.id) return;
          void completeTrip(currentTrip.id, {
            completionMode: "bypass",
            bypassReason: endOtpBypassReason,
            bypassNote: endOtpBypassNote,
          });
        }}
      />
      <TripCompletionOverlay
        summary={completedFareSummary}
        confirming={confirmingPayment}
        onReceived={confirmPaymentReceived}
        onHide={() => setCompletedFareSummary(null)}
      />
      <NavigationChooser
        target={navigationTarget}
        pickupGoogle={pickupGoogle}
        pickupWaze={pickupWaze}
        dropoffGoogle={dropoffGoogle}
        dropoffWaze={dropoffWaze}
        onClose={() => setNavigationTarget(null)}
      />

      <TripOfferPanel
        offer={offer}
        stops={offerStops}
        secondsLeft={secondsLeft}
        responding={offerResponding}
        onRespond={(action) => void respondToOffer(action)}
      />

      <DriverDrawer
        open={driverToolsOpen}
        driver={driver}
        levelLabel={driverLevel.label}
        completedTrips={earningsSnapshot.completedTrips}
        onClose={() => setDriverToolsOpen(false)}
        onNavigate={(path) => router.push(path)}
        onLogout={() => {
          setDriverToolsOpen(false);
          void supabaseClient.auth.signOut({ scope: "local" }).finally(() => router.replace("/driver/login"));
        }}
      />

      <div className="moovu-shell">
        {(info || gpsAttentionNotice) && (
          <div className="driver-map-notices grid gap-3 md:grid-cols-2">
            {info && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                {info}
              </div>
            )}

            {gpsAttentionNotice && (
              <div
                className={`rounded-2xl border px-4 py-3 text-sm ${gpsNoticeClass(gpsNoticeTone(gpsAttentionNotice))}`}
              >
                <div>{gpsNoticeMessage(gpsAttentionNotice)}</div>
                <button
                  type="button"
                  className="mt-2 rounded-xl bg-white/80 px-3 py-2 text-xs font-bold text-slate-900 shadow-sm"
                  onClick={() => void retryCurrentGps()}
                  disabled={busy}
                >
                  Retry GPS
                </button>
              </div>
            )}
          </div>
        )}

        {!driver ? (
          <div className="moovu-card p-6 text-slate-700">
            Driver record not found.
          </div>
        ) : (
          <>
          {earningsSnapshot.amountOwed >= DRIVER_COMMISSION_LOCK_LIMIT * DRIVER_COMMISSION_WARNING_RATIO && (
            <section className={`mb-4 rounded-2xl border p-4 ${earningsSnapshot.amountOwed >= DRIVER_COMMISSION_LOCK_LIMIT ? "border-red-200 bg-red-50 text-red-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
              <div className="font-black">
                {earningsSnapshot.amountOwed >= DRIVER_COMMISSION_LOCK_LIMIT
                  ? "Commission payment required"
                  : "You’re approaching your MOOVU commission limit."}
              </div>
              <div className="mt-1 text-sm font-semibold">
                {money(earningsSnapshot.amountOwed)} owed · {money(DRIVER_COMMISSION_LOCK_LIMIT)} limit · {money(Math.max(0, DRIVER_COMMISSION_LOCK_LIMIT - earningsSnapshot.amountOwed))} remaining
              </div>
              <button
                type="button"
                className="moovu-btn moovu-btn-primary mt-3"
                onClick={() => router.push("/driver/commission-payments")}
              >
                View Commission / Pay Commission
              </button>
            </section>
          )}
          <div className="driver-map-first-layout">
            <section className="moovu-driver-home-stack">
              {!subscriptionAllowsOnline && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
                  <span>Activate a plan to go online and receive trip offers.</span>
                  <button type="button" className="moovu-btn moovu-btn-secondary" onClick={() => router.push("/driver/subscriptions")}>Choose plan</button>
                </div>
              )}

              <DriverMapSurface
                mapRef={mapRef}
                mapError={mapError}
                menuOpen={driverToolsOpen}
                todayEarnings={earningsSnapshot.todayEarnings}
                online={Boolean(driver.online)}
                busy={busy}
                subscriptionAllowsOnline={subscriptionAllowsOnline}
                satelliteMap={satelliteMap}
                onToggleMenu={() => setDriverToolsOpen((value) => !value)}
                onOpenEarnings={() => router.push("/driver/earnings")}
                onRetryGps={() => void retryCurrentGps()}
                onToggleMapType={() => {
                  const next = !satelliteMap;
                  setSatelliteMap(next);
                  mapInstanceRef.current?.setMapTypeId(next ? "hybrid" : "roadmap");
                }}
                onToggleOnline={() => void setOnlineServer(!driver.online)}
                onChoosePlan={() => router.push("/driver/subscriptions")}
              />

              {currentTrip && (
                <div className={tripSheetOpen ? "moovu-driver-active-trip is-open p-5" : "moovu-driver-active-trip p-5"}>
                  <button
                    type="button"
                    className="driver-trip-sheet-toggle"
                    onClick={() => setTripSheetOpen((open) => !open)}
                    aria-expanded={tripSheetOpen}
                  >
                    {tripSheetOpen ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
                    <span>{tripSheetOpen ? "Hide trip status" : `${tripStatusLabel(currentTrip.status)} · ${money(currentTrip.final_fare ?? currentTrip.fare_amount)}`}</span>
                  </button>
                  <div className="driver-trip-sheet-content">
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
                      Trip fare: {money(currentTrip.final_fare ?? currentTrip.fare_amount)}
                    </div>
                  </div>

                  {currentTrip.status === "ongoing" && (
                    <div className="mb-4 rounded-[24px] bg-gradient-to-r from-blue-700 to-cyan-600 px-5 py-4 text-white shadow-lg shadow-blue-900/15">
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-100">Trip fare</div>
                      <div className="mt-1 text-4xl font-black">{money(currentTrip.final_fare ?? currentTrip.fare_amount)}</div>
                      <div className="mt-1 text-xs font-semibold text-blue-100">Booking fare plus customer-added stops. GPS and trip time do not change it.</div>
                      {Number(currentTrip.fare_adjustment_amount ?? 0) > 0 && (
                        <div className="mt-3 text-sm font-black text-white">
                          {money(currentTrip.estimated_fare ?? currentTrip.fare_amount)} initial + {money(currentTrip.fare_adjustment_amount)} stop
                        </div>
                      )}
                    </div>
                  )}

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
                      {pickupInstruction && (
                        <div className="mt-3 rounded-xl bg-white/85 px-3 py-2">
                          <div className="text-[10px] font-black uppercase tracking-[0.12em] text-blue-700">
                            Pickup instruction
                          </div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {pickupInstruction}
                          </div>
                        </div>
                      )}
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
                      <div className="flex flex-wrap gap-3">
                        <button
                          className="moovu-btn moovu-btn-primary"
                          disabled={busy}
                          onClick={() => arriveTrip(currentTrip.id)}
                        >
                          Mark as arrived
                        </button>
                        <button
                          type="button"
                          className="moovu-btn moovu-btn-secondary border border-red-200 text-red-700"
                          disabled={busy}
                          onClick={() => setShowCancelTripForm((open) => !open)}
                        >
                          Cancel trip
                        </button>
                      </div>
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

                        <div className="mt-4 flex flex-wrap gap-3">
                          <button
                            type="button"
                            className="moovu-btn moovu-btn-secondary border border-red-200 text-red-700"
                            disabled={busy}
                            onClick={() => setShowCancelTripForm((open) => !open)}
                          >
                            Cancel trip
                          </button>
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

                        {!showEndOtp && !showEndOtpBypass && (
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <button
                              onClick={() => setShowEndOtp(true)}
                              disabled={busy}
                              className="moovu-btn moovu-btn-primary w-full"
                            >
                              Complete with End OTP
                            </button>
                            <button
                              onClick={() => setShowEndOtpBypass(true)}
                              disabled={busy}
                              className="moovu-btn moovu-btn-secondary w-full"
                            >
                              Complete without End OTP
                            </button>
                          </div>
                        )}
                        {showEndOtp && (
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
                                  await completeTrip(currentTrip.id, {
                                    otp: endOtp,
                                    completionMode: "otp",
                                  });
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

                    {showCancelTripForm &&
                      ["assigned", "arrived"].includes(currentTrip.status) && (
                        <div className="mt-4 rounded-[24px] border border-red-100 bg-red-50 p-4">
                          <div className="text-xs font-black uppercase tracking-[0.14em] text-red-700">
                            Cancel accepted trip
                          </div>
                          <p className="mt-2 text-sm font-medium leading-6 text-red-900">
                            Use this only before the trip starts. The customer and admin will be notified immediately.
                          </p>
                          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                            <select
                              value={cancelTripReason}
                              onChange={(e) => setCancelTripReason(e.target.value)}
                              className="moovu-input"
                              disabled={busy}
                            >
                              {DRIVER_CANCEL_REASONS.map((reason) => (
                                <option key={reason} value={reason}>
                                  {reason}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="moovu-btn bg-red-600 text-white disabled:opacity-60"
                              disabled={busy}
                              onClick={() => void cancelCurrentTrip(currentTrip.id, cancelTripReason)}
                            >
                              {busy ? "Cancelling..." : "Confirm cancel"}
                            </button>
                            <button
                              type="button"
                              className="moovu-btn moovu-btn-secondary"
                              disabled={busy}
                              onClick={() => setShowCancelTripForm(false)}
                            >
                              Keep trip
                            </button>
                          </div>
                        </div>
                      )}
                  </div>
                  </div>
                </div>
              )}
            </section>

            <aside className="hidden">
              {driverToolsOpen && (
                <>
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
                </>
              )}

              <section id="driver-trip-offer-card" className={`moovu-driver-offer-card p-5 ${offer ? "has-offer" : ""}`}>
                <div className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">
                  Trip offers
                </div>

                {!offer ? (
                  <div className="driver-offer-empty">
                    <span><CarFront aria-hidden="true" /></span>
                    <strong>No trip offers right now</strong>
                    <p>Stay online to receive nearby trip requests.</p>
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-[24px] border border-blue-100 bg-blue-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="moovu-driver-offer-alert-dot" />
                            <span className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
                              New trip nearby
                            </span>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-blue-800 shadow-sm">
                              {secondsLeft != null ? `${secondsLeft}s left` : "Respond now"}
                            </span>
                          </div>
                          <div className="mt-3 text-2xl font-black text-slate-950">
                            {money(offer.final_fare ?? offer.fare_amount)}
                          </div>
                          <div className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                            {rideTypeLabel(offer.ride_option)} - {offer.distance_km == null ? "Distance pending" : `${Number(offer.distance_km).toFixed(1)} km`} - {offer.duration_min == null ? "Time pending" : `${Math.round(Number(offer.duration_min))} min`}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3">
                        <div className="rounded-2xl bg-white/90 p-3 text-sm font-semibold text-slate-900">
                          <span className="block text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Pickup</span>
                          <span className="mt-1 block">{offer.pickup_address ?? "-"}</span>
                        </div>
                        <div className="rounded-2xl bg-white/90 p-3 text-sm font-semibold text-slate-900">
                          <span className="block text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Dropoff</span>
                          <span className="mt-1 block">{offer.dropoff_address ?? "-"}</span>
                        </div>
                        {offerStops.length > 0 && (
                          <div className="rounded-2xl bg-white/90 p-3 text-sm font-semibold text-slate-900">
                            <span className="block text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Stops</span>
                            <span className="mt-1 block">
                              {offerStops.map((stop, index) => `Stop ${index + 1}: ${stop.address}`).join(" | ")}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        className="moovu-driver-accept"
                        disabled={offerResponding !== null}
                        onClick={() => void respondToOffer("accept")}
                      >
                        {offerResponding === "accept" ? "ACCEPTING..." : "ACCEPT"}
                      </button>
                      <button
                        type="button"
                        className="moovu-driver-decline"
                        disabled={offerResponding !== null}
                        onClick={() => void respondToOffer("reject")}
                      >
                        {offerResponding === "reject" ? "DECLINING..." : "DECLINE"}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <nav className="driver-home-quick-actions" aria-label="Driver quick actions">
                <button type="button" onClick={() => setDriverToolsOpen(true)}>
                  <span className="is-blue"><SlidersHorizontal aria-hidden="true" /></span>
                  <strong>Ride preferences</strong>
                </button>
                <button type="button" onClick={() => router.push("/driver/earnings")}>
                  <span className="is-green"><WalletCards aria-hidden="true" /></span>
                  <strong>Earnings</strong>
                </button>
                <button type="button" onClick={() => router.push("/driver/history")}>
                  <span className="is-orange"><ChartNoAxesColumnIncreasing aria-hidden="true" /></span>
                  <strong>Performance</strong>
                </button>
                <button type="button" onClick={() => router.push("/driver/contact")}>
                  <span className="is-violet"><Headphones aria-hidden="true" /></span>
                  <strong>Help</strong>
                </button>
              </nav>

              <button
                type="button"
                className="driver-home-safety-card"
                onClick={() => router.push("/driver/contact")}
              >
                <span><ShieldCheck aria-hidden="true" /></span>
                <span>
                  <strong>Stay safe on the road</strong>
                  <small>Follow traffic rules and drive safely.</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            </aside>
          </div>
          </>
        )}
      </div>

      <FloatingCustomerChat
        tripId={currentTrip && canOpenTripChat ? currentTrip.id : null}
        tripSheetOpen={tripSheetOpen}
        initialOpen={
          Boolean(currentTrip) &&
          shouldOpenChatFromNotification &&
          (!notificationTripId || notificationTripId === currentTrip?.id)
        }
      />

      <DriverBottomNav />
    </main>
  );
}

