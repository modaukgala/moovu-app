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
import { minimumRequiredTripSeconds } from "@/lib/geo/tripGuards";
import { getDriverLevel } from "@/lib/trust/driverLevels";
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
  current_fare?: number | null;
  actual_distance_km?: number | null;
  actual_duration_min?: number | null;
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
  verification_status?: string | null;
  completed_trips_count?: number | null;
  average_rating?: number | null;
};

type Rating = {
  id: string;
  rating: number;
  comment: string | null;
};

type SafetyAudioRecording = {
  id: string;
  file_name: string;
  mime_type: string;
  duration_seconds: number;
  status: string;
  created_at: string;
  url: string | null;
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

type DetailModal =
  | "route"
  | "fare"
  | "safety"
  | "support"
  | "receipt"
  | "progress"
  | "driver"
  | "vehicle"
  | "payment"
  | "otp"
  | null;
type OtpModal = "start" | "end" | null;

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

function displayDistance(value: number | null | undefined) {
  return value == null ? "--" : `${Number(value).toFixed(1)} km`;
}

function displayDuration(value: number | null | undefined) {
  return value == null ? "--" : `${Math.round(Number(value))} min`;
}

function rideTypeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "group" || normalized === "xl" || normalized.includes("xl")) return "MOOVU Go XL";
  if (normalized === "scheduled") return "Scheduled ride";
  return "MOOVU Go";
}

function driverRatingLabel(driver: Driver | null) {
  const rating = Number(driver?.average_rating ?? 0);
  return rating > 0 ? `${rating.toFixed(1)} / 5` : "New Driver";
}

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function driverInitials(driver: Driver | null) {
  const first = driver?.first_name?.trim()?.[0] ?? "";
  const last = driver?.last_name?.trim()?.[0] ?? "";
  return `${first}${last}`.toUpperCase() || "MD";
}

function friendlyTripError(value: unknown) {
  const message = typeof value === "string" ? value : "";
  if (!message || /supabase|postgres|schema|column|rls|jwt|service_role|stack depth/i.test(message)) {
    return "Something went wrong while loading your trip. Please try again.";
  }
  return message;
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

function detailModalTitle(value: Exclude<DetailModal, null>) {
  switch (value) {
    case "otp":
      return "OTPs";
    case "progress":
      return "Trip progress";
    case "driver":
      return "Driver details";
    case "vehicle":
      return "Vehicle details";
    case "payment":
      return "Payment details";
    default:
      return value;
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
  const [activeDetailModal, setActiveDetailModal] = useState<DetailModal>(null);
  const [detailsMenuOpen, setDetailsMenuOpen] = useState(false);
  const [activeOtpModal, setActiveOtpModal] = useState<OtpModal>(null);
  const [dismissedOtpModal, setDismissedOtpModal] = useState<OtpModal>(null);
  const [audioRecordings, setAudioRecordings] = useState<SafetyAudioRecording[]>([]);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioDeletingId, setAudioDeletingId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioSavedMessage, setAudioSavedMessage] = useState<string | null>(null);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

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
  const ongoingStartedAtRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingSecondsRef = useRef(0);

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

  const canUseSafetyRecording = useMemo(() => {
    const status = String(trip?.status ?? "").toLowerCase();
    if (["assigned", "arrived", "ongoing"].includes(status)) return true;
    if (status !== "completed") return false;

    const completedAt = trip?.completed_at || trip?.fare_finalized_at || trip?.created_at;
    if (!completedAt) return false;

    const completedMs = new Date(completedAt).getTime();
    return Number.isFinite(completedMs) && Date.now() - completedMs <= 24 * 60 * 60 * 1000;
  }, [trip?.completed_at, trip?.created_at, trip?.fare_finalized_at, trip?.status]);

  const stopAudioTracks = useCallback(() => {
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
  }, []);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current != null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const loadAudioRecordings = useCallback(async () => {
    if (!tripId) return;

    const accessToken = await getAccessToken();
    if (!accessToken) return;

    setAudioLoading(true);
    setAudioError(null);

    try {
      const res = await fetch(`/api/customer/trip-audio?tripId=${encodeURIComponent(tripId)}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setAudioError(json?.error || "Could not load safety recordings.");
        return;
      }

      setAudioRecordings((json.recordings ?? []) as SafetyAudioRecording[]);
    } catch (error) {
      console.error("[ride-safety-audio] load failed", error);
      setAudioError("Could not load safety recordings.");
    } finally {
      setAudioLoading(false);
    }
  }, [getAccessToken, tripId]);

  const uploadAudioRecording = useCallback(async (blob: Blob, durationSeconds: number) => {
    const accessToken = await getAccessToken();
    if (!accessToken || !tripId) {
      setAudioError("Please sign in again before saving this recording.");
      return;
    }

    setAudioUploading(true);
    setAudioError(null);
    setAudioSavedMessage(null);

    try {
      const form = new FormData();
      form.append("tripId", tripId);
      form.append("durationSeconds", String(durationSeconds));
      form.append("file", blob, `moovu-safety-recording-${Date.now()}.webm`);

      const res = await fetch("/api/customer/trip-audio", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setAudioError(json?.error || "Could not save this recording. Please try again.");
        return;
      }

      setAudioRecordings((current) => [json.recording as SafetyAudioRecording, ...current]);
      setAudioSavedMessage("Recording saved securely with this trip.");
      notifyInApp({
        title: "Safety recording saved",
        body: "Your audio recording is linked to this trip.",
        tone: "success",
      });
    } catch (error) {
      console.error("[ride-safety-audio] upload failed", error);
      setAudioError("Could not save this recording. Please try again.");
    } finally {
      setAudioUploading(false);
    }
  }, [getAccessToken, tripId]);

  const startSafetyRecording = useCallback(async () => {
    setAudioError(null);
    setAudioSavedMessage(null);

    if (!canUseSafetyRecording) {
      setAudioError("Safety recording is only available during active trips or shortly after completion.");
      return;
    }

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setAudioError("Audio recording is not supported on this device or browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream);

      audioChunksRef.current = [];
      audioStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      setRecordingSeconds(0);
      setIsRecordingAudio(true);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onerror = (event) => {
        console.error("[ride-safety-audio] recorder error", event);
        setAudioError("Recording stopped unexpectedly. Please try again.");
      };

      recorder.onstop = () => {
        const duration = recordingSecondsRef.current;
        const blobType = recorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: blobType });
        audioChunksRef.current = [];
        stopAudioTracks();
        clearRecordingTimer();
        setIsRecordingAudio(false);

        if (blob.size <= 0) {
          setAudioError("No audio was captured. Please try again.");
          return;
        }

        void uploadAudioRecording(blob, duration);
      };

      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((value) => value + 1);
      }, 1000);
      recorder.start();
    } catch (error) {
      console.error("[ride-safety-audio] permission/start failed", error);
      stopAudioTracks();
      clearRecordingTimer();
      setIsRecordingAudio(false);
      setAudioError("Microphone permission is needed to record audio. Please allow microphone access and try again.");
    }
  }, [canUseSafetyRecording, clearRecordingTimer, stopAudioTracks, uploadAudioRecording]);

  const stopSafetyRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  const deleteAudioRecording = useCallback(async (id: string) => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      setAudioError("Please sign in again before deleting this recording.");
      return;
    }

    setAudioDeletingId(id);
    setAudioError(null);

    try {
      const res = await fetch("/api/customer/trip-audio", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setAudioError(json?.error || "Could not delete this recording. Please try again.");
        return;
      }

      setAudioRecordings((current) => current.filter((recording) => recording.id !== id));
      setAudioSavedMessage("Recording removed from your trip view.");
    } catch (error) {
      console.error("[ride-safety-audio] delete failed", error);
      setAudioError("Could not delete this recording. Please try again.");
    } finally {
      setAudioDeletingId(null);
    }
  }, [getAccessToken]);

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
      setMsg(friendlyTripError(json?.error));
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
    recordingSecondsRef.current = recordingSeconds;
  }, [recordingSeconds]);

  useEffect(() => {
    if (activeDetailModal === "safety") {
      void loadAudioRecordings();
    }
  }, [activeDetailModal, loadAudioRecordings]);

  useEffect(() => {
    return () => {
      clearRecordingTimer();
      stopAudioTracks();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, [clearRecordingTimer, stopAudioTracks]);

  useEffect(() => {
    if (trip?.status === "ongoing") {
      if (!ongoingStartedAtRef.current) ongoingStartedAtRef.current = Date.now();
      return;
    }

    ongoingStartedAtRef.current = null;
  }, [trip?.status]);

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
        setDismissedOtpModal(null);
        setActiveOtpModal("start");
        notifyInApp({
          title: "Driver arrived",
          body: "Share the start OTP only when you are ready to leave.",
          tone: "offer",
          loud: true,
        });
      }

      if (trip.status === "ongoing") {
        setDismissedOtpModal(null);
        ongoingStartedAtRef.current = Date.now();
        notifyInApp({
          title: "Trip started",
          body: "Start OTP verified. Your ride is now in progress.",
          tone: "success",
          loud: true,
        });
      }

      if (trip.status === "completed") {
        setActiveOtpModal(null);
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
        setAddStopError(friendlyTripError(json?.error || "Could not load that stop. Please choose another place."));
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
        setAddStopError(friendlyTripError(json?.error || "Could not add this stop. Please try again."));
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

  const canOpenChat = useMemo(() => {
    if (!trip?.driver_id) return false;
    return ["assigned", "arrived", "ongoing", "completed", "cancelled"].includes(trip.status);
  }, [trip]);

  const canShowDriverDetails = useMemo(() => {
    if (!driver || !trip) return false;
    return ["assigned", "arrived", "ongoing", "completed", "cancelled"].includes(trip.status);
  }, [driver, trip]);

  const searchingForDriver = useMemo(() => {
    if (!trip) return false;
    return !trip.driver_id && ["requested", "offered", "scheduled"].includes(trip.status);
  }, [trip]);

  const carText = useMemo(() => {
    if (!driver) return "--";
    return [driver.vehicle_make, driver.vehicle_model, driver.vehicle_color]
      .filter(Boolean)
      .join(" - ") || "--";
  }, [driver]);
  const driverLevel = useMemo(
    () => getDriverLevel(driver?.completed_trips_count),
    [driver?.completed_trips_count],
  );

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

  const stageDetail = useMemo(() => {
    switch (trip?.status) {
      case "requested":
      case "offered":
        return {
          eyebrow: "Live request",
          title: "Looking for nearby MOOVU drivers",
          body: "Your request is being sent to available drivers near you.",
          eta: "Checking availability",
        };
      case "assigned":
        return {
          eyebrow: "Driver assigned",
          title: "Driver on the way",
          body: "Watch the map and confirm the vehicle, plate and driver before getting in.",
          eta: displayDuration(trip.duration_min),
        };
      case "arrived":
        return {
          eyebrow: "Pickup",
          title: "Driver has arrived",
          body: "Give the start OTP only when you are ready to begin the ride.",
          eta: "At pickup",
        };
      case "ongoing":
        return {
          eyebrow: "On trip",
          title: "Trip started",
          body: "Your ride is in progress. Keep trip details visible until completion.",
          eta: displayDuration(trip.duration_min),
        };
      case "completed":
        return {
          eyebrow: "Receipt ready",
          title: "Trip completed",
          body: "Your trip is complete. You can open the receipt or rate the ride.",
          eta: "Done",
        };
      case "cancelled":
        return {
          eyebrow: "Closed",
          title: "Trip cancelled",
          body: "This request has been closed. Cancellation details are shown below.",
          eta: "Cancelled",
        };
      default:
        return {
          eyebrow: "Ride status",
          title: statusLabel(trip?.status),
          body: statusCta,
          eta: "Live",
        };
    }
  }, [statusCta, trip?.duration_min, trip?.status]);

  const progressSteps = useMemo(() => {
    const order = ["requested", "assigned", "arrived", "ongoing", "completed"];
    const labels = ["Request", "Driver", "Pickup", "Trip", "Done"];
    const currentIndex =
      trip?.status === "offered"
        ? 0
        : trip?.status === "cancelled"
          ? -1
          : Math.max(0, order.indexOf(trip?.status ?? "requested"));

    return labels.map((label, index) => ({
      label,
      active: currentIndex >= index,
      current: currentIndex === index,
    }));
  }, [trip?.status]);

  const tripTotalLabel = useMemo(() => {
    if (trip?.status === "completed") return "Final total";
    if (trip?.status === "cancelled") return "Trip total";
    return "Pending total";
  }, [trip?.status]);

  const displayTotal = useMemo(() => {
    if (!trip) return 0;
    return Number(trip.current_fare ?? trip.final_fare ?? trip.fare_amount ?? 0);
  }, [trip]);

  const routeAddition = useMemo(() => {
    if (!trip) return 0;
    return Number(trip.final_add_stop_increase ?? 0) + Number(trip.stop_waiting_fee ?? 0);
  }, [trip]);

  const endOtpReadyAtMs = useMemo(() => {
    if (!trip || trip.status !== "ongoing") return null;
    const startedAt = ongoingStartedAtRef.current;
    if (!startedAt) return null;
    return startedAt + minimumRequiredTripSeconds(trip.duration_min) * 1000;
  }, [trip]);

  const endOtpReady = useMemo(() => {
    if (!endOtpReadyAtMs) return false;
    return nowMs >= endOtpReadyAtMs;
  }, [endOtpReadyAtMs, nowMs]);

  const endOtpCountdown = useMemo(() => {
    if (!endOtpReadyAtMs || endOtpReady) return "";
    const remainingSeconds = Math.max(0, Math.ceil((endOtpReadyAtMs - nowMs) / 1000));
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = String(remainingSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [endOtpReady, endOtpReadyAtMs, nowMs]);

  const startOtpAvailable = Boolean(
    trip && trip.status === "arrived" && !trip.start_otp_verified && trip.start_otp
  );

  const endOtpAvailable = Boolean(
    trip && trip.status === "ongoing" && !trip.end_otp_verified && trip.end_otp && endOtpReady
  );

  useEffect(() => {
    if (startOtpAvailable && dismissedOtpModal !== "start" && activeOtpModal !== "start") {
      setActiveOtpModal("start");
    }
  }, [activeOtpModal, dismissedOtpModal, startOtpAvailable]);

  useEffect(() => {
    if (endOtpAvailable && dismissedOtpModal !== "end" && activeOtpModal !== "end") {
      setActiveOtpModal("end");
    }
  }, [activeOtpModal, dismissedOtpModal, endOtpAvailable]);

  const fareHelperText = useMemo(() => {
    if (trip?.status === "completed") return "Receipt-ready total after trip completion.";
    if (trip?.status === "cancelled") return "Shown for reference after cancellation.";
    return "This total stays pending until the trip ends and the end OTP is verified.";
  }, [trip?.status]);

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
            <div className="mt-5 rounded-3xl bg-slate-950 px-5 py-6 text-center text-white">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-300">Final fare to pay</div>
              <div className="mt-2 text-5xl font-black">{money(displayTotal)}</div>
              <div className="mt-2 text-xs font-semibold text-slate-300">Pay this amount to your driver.</div>
            </div>
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
      {activeOtpModal && (
        <div className="customer-otp-overlay">
          <section className="customer-otp-popup" role="dialog" aria-modal="true">
            <div className="customer-otp-kicker">
              {activeOtpModal === "start" ? "Driver has arrived" : "Trip completion"}
            </div>
            <h2>{activeOtpModal === "start" ? "START TRIP OTP" : "END TRIP OTP"}</h2>
            <div className="customer-otp-code">
              {activeOtpModal === "start" ? trip.start_otp ?? "--" : trip.end_otp ?? "--"}
            </div>
            <p>
              {activeOtpModal === "start"
                ? "Give this code to your driver to begin the trip."
                : "Give this code to your driver to complete the trip."}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="moovu-btn moovu-btn-primary"
                onClick={() => {
                  setActiveOtpModal(null);
                  window.setTimeout(() => {
                    document.getElementById("customer-driver-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }, 80);
                }}
              >
                {activeOtpModal === "start" ? "Show Driver" : "View Driver"}
              </button>
              <button
                type="button"
                className="moovu-btn moovu-btn-secondary"
                onClick={() => {
                  setDismissedOtpModal(activeOtpModal);
                  setActiveOtpModal(null);
                }}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}
      {detailsMenuOpen && (
        <div className="customer-detail-overlay" onClick={() => setDetailsMenuOpen(false)}>
          <section
            className="customer-detail-sheet customer-more-menu-sheet"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="customer-detail-handle" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="moovu-section-title">More details</div>
                <h2 className="mt-2 text-2xl font-black text-slate-950">Trip menu</h2>
              </div>
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-lg font-black text-slate-600"
                onClick={() => setDetailsMenuOpen(false)}
                aria-label="Close trip menu"
              >
                x
              </button>
            </div>
            <div className="customer-more-menu-grid">
              {([
                ["progress", "Trip progress"],
                ["driver", "Driver details"],
                ["vehicle", "Vehicle details"],
                ["route", "Route"],
                ["fare", "Fare"],
                ["otp", "OTPs"],
                ["safety", "Safety"],
                ["support", "Support"],
                ["receipt", "Receipt"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className="customer-more-menu-item"
                  onClick={() => {
                    setDetailsMenuOpen(false);
                    setActiveDetailModal(key);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {activeDetailModal && (
        <div className="customer-detail-overlay" onClick={() => setActiveDetailModal(null)}>
          <section
            className="customer-detail-sheet"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="customer-detail-handle" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="moovu-section-title">Trip details</div>
                <h2 className="mt-2 text-2xl font-black capitalize text-slate-950">
                  {detailModalTitle(activeDetailModal)}
                </h2>
              </div>
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-lg font-black text-slate-600"
                onClick={() => setActiveDetailModal(null)}
                aria-label="Close trip details"
              >
                x
              </button>
            </div>

            {activeDetailModal === "route" && (
              <div className="customer-detail-body">
                <div className="moovu-route-mini">
                  <div><strong>Pickup</strong><span>{displayValue(trip.pickup_address)}</span></div>
                  {tripStops.map((stop, index) => (
                    <div key={`${stop.address}-${index}`}><strong>Stop {index + 1}</strong><span>{displayValue(stop.address)}</span></div>
                  ))}
                  <div><strong>Destination</strong><span>{displayValue(trip.dropoff_address)}</span></div>
                </div>
                <div className="customer-detail-grid">
                  <div><span>Ride type</span><strong>{rideTypeLabel(trip.ride_type)}</strong></div>
                  <div><span>Distance</span><strong>{displayDistance(trip.distance_km)}</strong></div>
                  <div><span>Duration</span><strong>{displayDuration(trip.duration_min)}</strong></div>
                  <div><span>Stops</span><strong>{tripStops.length}</strong></div>
                </div>
              </div>
            )}

            {activeDetailModal === "fare" && (
              <div className="customer-detail-body">
                <div className="customer-fare-total">
                  <span>{tripTotalLabel}</span>
                  <strong>{money(displayTotal)}</strong>
                  <em>{fareHelperText}</em>
                </div>
                <div className="customer-detail-grid">
                  <div><span>Estimated fare</span><strong>{money(trip.estimated_fare ?? trip.fare_amount)}</strong></div>
                  <div><span>Stop additions</span><strong>{money(routeAddition)}</strong></div>
                  <div><span>{trip.status === "ongoing" ? "Current fare" : "Final fare"}</span><strong>{money(displayTotal)}</strong></div>
                  <div><span>Payment</span><strong className="capitalize">{displayValue(trip.payment_method)}</strong></div>
                  <div><span>Route distance</span><strong>{displayDistance(trip.actual_distance_km ?? trip.distance_km)}</strong></div>
                  <div><span>Trip time</span><strong>{displayDuration(trip.actual_duration_min ?? trip.duration_min)}</strong></div>
                </div>
              </div>
            )}

            {activeDetailModal === "safety" && (
              <div className="customer-detail-body">
                <div className="rounded-2xl bg-blue-50 p-4 text-sm font-semibold leading-6 text-blue-800">
                  Check driver details before entering the vehicle. MOOVU uses driver details, OTP trip starts, and live updates to help protect your trip.
                </div>
                <div className="rounded-[28px] border border-red-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-red-500">
                        Safety Audio Recording
                      </div>
                      <h3 className="mt-2 text-xl font-black text-slate-950">Record Audio</h3>
                      <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                        Use this only if you feel unsafe during a trip. Your recording will be saved securely with this trip.
                      </p>
                    </div>
                    {isRecordingAudio && (
                      <div className="rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700">
                        <span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                        Recording {formatTimer(recordingSeconds)}
                      </div>
                    )}
                  </div>

                  {!canUseSafetyRecording && (
                    <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-600">
                      Audio recording is only available during an assigned, arrived, ongoing, or recently completed trip.
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-3">
                    {!isRecordingAudio ? (
                      <button
                        type="button"
                        className="moovu-btn moovu-btn-primary"
                        disabled={!canUseSafetyRecording || audioUploading}
                        onClick={startSafetyRecording}
                      >
                        {audioUploading ? "Saving..." : "Record Audio"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="moovu-btn bg-red-600 text-white shadow-lg shadow-red-200 hover:bg-red-700"
                        onClick={stopSafetyRecording}
                      >
                        Stop Recording
                      </button>
                    )}
                    <button
                      type="button"
                      className="moovu-btn moovu-btn-secondary"
                      onClick={() => void loadAudioRecordings()}
                      disabled={audioLoading}
                    >
                      {audioLoading ? "Loading..." : "Refresh Recordings"}
                    </button>
                  </div>

                  {audioError && (
                    <div className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold leading-6 text-red-700">
                      {audioError}
                    </div>
                  )}
                  {audioSavedMessage && (
                    <div className="mt-4 rounded-2xl bg-emerald-50 p-3 text-sm font-semibold leading-6 text-emerald-700">
                      {audioSavedMessage}
                    </div>
                  )}

                  <div className="mt-5 space-y-3">
                    {audioLoading && audioRecordings.length === 0 && (
                      <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                        Loading saved recordings...
                      </div>
                    )}
                    {!audioLoading && audioRecordings.length === 0 && (
                      <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                        No safety recordings saved for this trip yet.
                      </div>
                    )}
                    {audioRecordings.map((recording) => (
                      <div key={recording.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-black text-slate-950">
                              {new Date(recording.created_at).toLocaleString()}
                            </div>
                            <div className="text-xs font-bold text-slate-500">
                              Duration {formatTimer(Number(recording.duration_seconds ?? 0))}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700"
                            disabled={audioDeletingId === recording.id}
                            onClick={() => void deleteAudioRecording(recording.id)}
                          >
                            {audioDeletingId === recording.id ? "Removing..." : "Delete"}
                          </button>
                        </div>
                        {recording.url ? (
                          <div className="mt-3 space-y-2">
                            <audio controls className="w-full" src={recording.url}>
                              <track kind="captions" />
                            </audio>
                            <a
                              href={recording.url}
                              download={recording.file_name}
                              className="inline-flex text-sm font-black text-blue-700 underline"
                            >
                              Download recording
                            </a>
                          </div>
                        ) : (
                          <div className="mt-3 rounded-xl bg-white p-3 text-sm font-semibold text-slate-600">
                            Playback link expired. Refresh recordings to generate a new secure link.
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Link href={`/ride/${trip.id}/share`} className="moovu-btn moovu-btn-primary justify-center">
                    Share Trip
                  </Link>
                  <button
                    type="button"
                    className="moovu-btn moovu-btn-secondary"
                    onClick={() => setMsg("SOS support is coming soon. For now, contact local emergency services if you are in immediate danger.")}
                  >
                    SOS Placeholder
                  </button>
                </div>
              </div>
            )}

            {activeDetailModal === "support" && (
              <div className="customer-detail-body">
                <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">
                  Need help with this trip? Report an issue or contact MOOVU support from here.
                </div>
                {canAddStop && (
                  <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                    <div className="text-sm font-black text-blue-900">Need to add a stop?</div>
                    <p className="mt-2 text-sm font-semibold leading-6 text-blue-800">
                      You can add up to 2 stops. Extra route cost is discounted by 40%.
                    </p>
                    <button
                      type="button"
                      className="moovu-btn moovu-btn-primary mt-3"
                      onClick={() => {
                        setActiveDetailModal(null);
                        setAddStopOpen(true);
                      }}
                    >
                      Add stop
                    </button>
                  </div>
                )}
                {trip.status === "cancelled" ? (
                  <div className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">
                    Trip cancelled. Reason: {trip.cancel_reason ?? "--"}
                    {Number(trip.cancellation_fee_amount ?? 0) > 0 && (
                      <div className="mt-2">Cancellation fee: {money(trip.cancellation_fee_amount)}</div>
                    )}
                  </div>
                ) : trip.status === "completed" ? (
                  <div className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                    Completed trips cannot be cancelled.
                  </div>
                ) : trip.status === "ongoing" ? (
                  <div className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-700">
                    Once a trip has started, use support for any issue instead of cancelling here.
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-100 bg-white p-4">
                    <label className="mb-2 block text-sm font-black text-slate-700">
                      Cancellation reason
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
                    <button
                      disabled={!canCancel || cancelBusy}
                      onClick={cancelTrip}
                      className="moovu-btn mt-3 bg-red-600 text-white disabled:opacity-60"
                    >
                      {cancelBusy ? "Cancelling..." : cancellationPreview.label}
                    </button>
                    <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">
                      {cancellationPreview.fee > 0
                        ? "A late cancellation fee applies because a driver has started travelling to your pickup."
                        : "Cancellation is currently free under the MOOVU cancellation policy."}
                    </p>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Link href={`/ride/${trip.id}/support`} className="moovu-btn moovu-btn-primary justify-center">
                    Report Issue
                  </Link>
                  <Link href="/contact" className="moovu-btn moovu-btn-secondary justify-center">
                    Contact Support
                  </Link>
                </div>
              </div>
            )}

            {activeDetailModal === "receipt" && (
              <div className="customer-detail-body">
                <div className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-800">
                  Your receipt is available after trip completion and remains accessible from ride history.
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Link href={`/ride/${trip.id}/receipt`} className="moovu-btn moovu-btn-primary justify-center">
                    Open Receipt
                  </Link>
                  {trip.status === "completed" && !rating && (
                    <Link href={`/ride/${trip.id}/rate`} className="moovu-btn moovu-btn-secondary justify-center">
                      Rate Trip
                    </Link>
                  )}
                </div>
              </div>
            )}

            {activeDetailModal === "progress" && (
              <div className="customer-detail-body">
                <div className="customer-trip-progress" aria-label="Trip progress">
                  {progressSteps.map((step) => (
                    <div
                      key={step.label}
                      className={[
                        "customer-trip-progress-step",
                        step.active ? "is-active" : "",
                        step.current ? "is-current" : "",
                      ].join(" ")}
                    >
                      <span />
                      <strong>{step.label}</strong>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl bg-blue-50 p-4 text-sm font-semibold leading-6 text-blue-800">
                  {stageDetail.body}
                </div>
                <div className="customer-detail-grid">
                  <div><span>Current status</span><strong>{statusLabel(trip.status)}</strong></div>
                  <div><span>ETA</span><strong>{stageDetail.eta}</strong></div>
                  <div><span>Live state</span><strong>{tracking?.liveState?.replace(/_/g, " ") || statusLabel(trip.status)}</strong></div>
                  <div><span>Requested</span><strong>{trip.created_at ? new Date(trip.created_at).toLocaleString() : "--"}</strong></div>
                </div>
              </div>
            )}

            {activeDetailModal === "driver" && (
              <div className="customer-detail-body">
                {!canShowDriverDetails ? (
                  <div className="rounded-2xl bg-blue-50 p-4 text-sm font-semibold leading-6 text-blue-800">
                    Driver details unlock after a MOOVU driver accepts your trip.
                  </div>
                ) : (
                  <>
                    <div className="customer-verified-driver-panel">
                      <div className="customer-verified-badge">
                        <span />
                        Verified MOOVU Driver
                      </div>
                      <p className="mt-2 text-xs font-semibold leading-5 text-emerald-800">
                        Always confirm the vehicle, plate and driver before starting your trip.
                      </p>
                    </div>
                    <div className="customer-detail-grid">
                      <div><span>Name</span><strong>{driverName}</strong></div>
                      <div><span>Phone</span><strong>{displayValue(driver?.phone)}</strong></div>
                      <div><span>Completed trips</span><strong>{Number(driver?.completed_trips_count ?? 0)}</strong></div>
                      <div><span>Rating</span><strong>{driverRatingLabel(driver)}</strong></div>
                      <div><span>Location</span><strong>{tracking?.driverFresh ? "Online now" : "Updates pending"}</strong></div>
                      <div><span>Driver level</span><strong>{driverLevel.label}</strong></div>
                    </div>
                    {driver?.phone && (
                      <a href={`tel:${driver.phone}`} className="moovu-btn moovu-btn-primary justify-center">
                        Call driver
                      </a>
                    )}
                  </>
                )}
              </div>
            )}

            {activeDetailModal === "vehicle" && (
              <div className="customer-detail-body">
                {!canShowDriverDetails ? (
                  <div className="rounded-2xl bg-blue-50 p-4 text-sm font-semibold leading-6 text-blue-800">
                    Vehicle details unlock after a MOOVU driver accepts your trip.
                  </div>
                ) : (
                  <div className="customer-detail-grid">
                    <div><span>Vehicle</span><strong>{carText}</strong></div>
                    <div><span>Plate</span><strong>{displayValue(driver?.vehicle_registration)}</strong></div>
                    <div><span>Make</span><strong>{displayValue(driver?.vehicle_make)}</strong></div>
                    <div><span>Model</span><strong>{displayValue(driver?.vehicle_model)}</strong></div>
                    <div><span>Colour</span><strong>{displayValue(driver?.vehicle_color)}</strong></div>
                    <div><span>Year</span><strong>{displayValue(driver?.vehicle_year)}</strong></div>
                  </div>
                )}
              </div>
            )}

            {activeDetailModal === "payment" && (
              <div className="customer-detail-body">
                <div className="customer-fare-total">
                  <span>{tripTotalLabel}</span>
                  <strong>{money(displayTotal)}</strong>
                  <em>{fareHelperText}</em>
                </div>
                <div className="customer-detail-grid">
                  <div><span>Payment method</span><strong className="capitalize">{displayValue(trip.payment_method)}</strong></div>
                  <div><span>Trip status</span><strong>{statusLabel(trip.status)}</strong></div>
                  <div><span>Booked fare</span><strong>{money(trip.fare_amount)}</strong></div>
                  <div><span>Final fare</span><strong>{money(displayTotal)}</strong></div>
                </div>
              </div>
            )}

            {activeDetailModal === "otp" && (
              <div className="customer-detail-body">
                <div className="rounded-2xl bg-blue-50 p-4 text-sm font-semibold leading-6 text-blue-800">
                  OTPs are shown as popups only when they are needed. Share them with the driver only at the correct trip stage.
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    className="moovu-btn moovu-btn-primary"
                    disabled={!startOtpAvailable}
                    onClick={() => {
                      setActiveDetailModal(null);
                      setActiveOtpModal("start");
                    }}
                  >
                    View Start OTP
                  </button>
                  <button
                    type="button"
                    className="moovu-btn moovu-btn-primary"
                    disabled={!endOtpAvailable}
                    onClick={() => {
                      setActiveDetailModal(null);
                      setActiveOtpModal("end");
                    }}
                  >
                    View End OTP
                  </button>
                </div>
                {trip.status === "ongoing" && !endOtpReady && !trip.end_otp_verified && (
                  <div className="rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                    End OTP unlocks in {endOtpCountdown || "a moment"}.
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      <div className="moovu-shell">
        <section className="customer-trip-hero mb-4 hidden">
          <div className="min-w-0">
            <div className="moovu-section-title">{stageDetail.eyebrow}</div>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              {stageDetail.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
              {stageDetail.body}
            </p>
            <div className="customer-trip-progress mt-5" aria-label="Trip progress">
              {progressSteps.map((step) => (
                <div
                  key={step.label}
                  className={[
                    "customer-trip-progress-step",
                    step.active ? "is-active" : "",
                    step.current ? "is-current" : "",
                  ].join(" ")}
                >
                  <span />
                  <strong>{step.label}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="customer-trip-hero-side">
            <div className={statusChipClass(trip.status)}>
              <span className="moovu-chip-dot" />
              {statusLabel(trip.status)}
            </div>
            <div className="customer-trip-eta">
              <span>ETA</span>
              <strong>{stageDetail.eta}</strong>
            </div>
          </div>
        </section>

        <div className="grid gap-4">
          <section className="customer-trip-map-card">
            <div className="absolute left-4 top-4 z-10 rounded-full bg-white/95 px-4 py-2 text-sm font-black text-slate-700 shadow">
              Live route
            </div>
            <div className="absolute right-4 top-4 z-10 rounded-full bg-white/95 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-blue-700 shadow">
              {tracking?.liveState?.replace(/_/g, " ") || statusLabel(trip.status)}
            </div>

            {mapError ? (
              <div className="flex min-h-[52svh] items-center justify-center bg-slate-50 p-6 text-sm text-slate-700 sm:min-h-[60vh] xl:min-h-[68vh]">
                {mapError}
              </div>
            ) : (
              <div ref={mapRef} className="min-h-[52svh] w-full bg-slate-100 sm:min-h-[60vh] xl:min-h-[68vh]" />
            )}

            <div className="customer-trip-map-sheet">
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
                  <button
                    type="button"
                    onClick={() => setActiveDetailModal("receipt")}
                    className="moovu-btn moovu-btn-primary"
                  >
                    Receipt
                  </button>
                )}
              </div>
              <div className="customer-command-actions">
                {(["route", "fare", "safety", "support", "receipt"] as const).map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="customer-command-button"
                    onClick={() => setActiveDetailModal(action)}
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section id="customer-driver-card" className="customer-trip-compact-stack">
            <div className="customer-trip-compact-card">
              <div className="min-w-0">
                <div className="customer-trip-compact-kicker">
                  {rideTypeLabel(trip.ride_type)} {canShowDriverDetails ? `with ${driverName}` : ""}
                </div>
                <h2>{canShowDriverDetails ? driverName : searchingForDriver ? "Looking for nearby MOOVU drivers" : "MOOVU trip"}</h2>
                <p>{trip.created_at ? new Date(trip.created_at).toLocaleString() : "Live trip"}</p>
                <strong>
                  {money(displayTotal)}
                  {canShowDriverDetails ? ` · ${carText}` : " · Driver details after acceptance"}
                </strong>
                {canShowDriverDetails && (
                  <span>{displayValue(driver?.vehicle_registration)}</span>
                )}
              </div>
              <div className={canShowDriverDetails ? "customer-driver-avatar is-live" : "customer-driver-avatar"}>
                {canShowDriverDetails ? driverInitials(driver) : <span />}
              </div>
            </div>

            <div className="customer-trip-current-card">
              <div className="min-w-0">
                <div className="customer-trip-compact-kicker">Current status</div>
                <h3>{statusLabel(trip.status)}</h3>
                <p>{statusCta}</p>
              </div>
              <div className={statusChipClass(trip.status)}>
                <span className="moovu-chip-dot" />
                {statusLabel(trip.status)}
              </div>
            </div>

            {trip.status === "ongoing" && (
              <div className="rounded-[22px] bg-gradient-to-r from-blue-700 to-cyan-600 px-5 py-4 text-white shadow-lg shadow-blue-900/15">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-100">Live trip fare</div>
                <div className="mt-1 text-4xl font-black">{money(displayTotal)}</div>
                <div className="mt-1 text-xs font-semibold text-blue-100">This updates during your ride. The final amount is confirmed after the end OTP.</div>
              </div>
            )}

            <div className="customer-trip-action-tabs" aria-label="Trip actions">
              {(["route", "fare", "safety", "support", "receipt"] as const).map((action) => (
                <button
                  key={action}
                  type="button"
                  className="customer-trip-action-tab"
                  onClick={() => setActiveDetailModal(action)}
                >
                  {action}
                </button>
              ))}
            </div>

            <div className="customer-trip-compact-footer">
              <button
                type="button"
                className="customer-trip-more-button"
                onClick={() => setDetailsMenuOpen(true)}
              >
                More details
              </button>
              {trip.status === "completed" && (
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="customer-trip-more-button is-primary"
                >
                  Done
                </button>
              )}
            </div>
          </section>

          <aside className="hidden space-y-4">
            <section id="customer-driver-card" className="customer-trip-summary-card">
              <div className="customer-trip-summary-top">
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">
                    {rideTypeLabel(trip.ride_type)}
                  </div>
                  <h2 className="mt-2 truncate text-2xl font-black text-slate-950">
                    {canShowDriverDetails ? `With ${driverName}` : "Looking for driver"}
                  </h2>
                  <p className="mt-1 text-sm font-bold text-slate-500">
                    {trip.created_at ? new Date(trip.created_at).toLocaleString() : "Live trip"}
                  </p>
                </div>
                <div className={canShowDriverDetails ? "customer-driver-avatar is-live" : "customer-driver-avatar"}>
                  {canShowDriverDetails ? driverInitials(driver) : <span />}
                </div>
              </div>

              <div className="customer-trip-summary-money">
                <div>
                  <span>{tripTotalLabel}</span>
                  <strong>{money(displayTotal)}</strong>
                </div>
                <div className={statusChipClass(trip.status)}>
                  <span className="moovu-chip-dot" />
                  {statusLabel(trip.status)}
                </div>
              </div>

              {canShowDriverDetails && (
                <div className="customer-trip-summary-vehicle">
                  <div>
                    <span>Vehicle</span>
                    <strong>{carText}</strong>
                  </div>
                  <div>
                    <span>Plate</span>
                    <strong>{displayValue(driver?.vehicle_registration)}</strong>
                  </div>
                </div>
              )}

              {!canShowDriverDetails ? (
                <div className="mt-4 rounded-[24px] border border-blue-100 bg-[#eaf3ff] p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-xl shadow-sm">
                      {searchingForDriver ? "..." : "!"}
                    </div>
                    <div>
                      <div className="text-sm font-black text-[#244f9e]">
                        {searchingForDriver ? "Looking for nearby MOOVU drivers..." : "Nearby drivers are currently unavailable."}
                      </div>
                      <p className="mt-2 text-sm font-semibold leading-6 text-[#244f9e]">
                        {searchingForDriver
                          ? "Your request is being sent to available drivers near you."
                          : "Please try again shortly or keep your request open while we continue checking."}
                      </p>
                    </div>
                  </div>
                  <div className="customer-search-steps mt-4" aria-label="Driver search progress">
                    {["Checking online drivers", "Sending request", "Waiting for accept"].map((step, index) => (
                      <div key={step} className={searchingForDriver || index === 0 ? "customer-search-step is-active" : "customer-search-step"}>
                        <span />
                        <strong>{step}</strong>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="moovu-btn moovu-btn-secondary mt-4 w-full"
                    onClick={() => void loadTrip()}
                  >
                    Retry status check
                  </button>
                  <div className="mt-3 text-xs font-semibold text-blue-700">
                    Driver details, vehicle, phone, and chat unlock only after a driver accepts your trip.
                  </div>
                </div>
              ) : (
                <div className="mt-4 grid gap-3">
                  <div className="customer-verified-driver-panel">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="customer-verified-badge">
                          <span />
                          Verified MOOVU Driver
                        </div>
                        <p className="mt-2 text-xs font-semibold leading-5 text-emerald-800">
                          Always confirm the vehicle, plate and driver before starting your trip.
                        </p>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-xs font-black ${driverLevel.className}`}>
                        {driverLevel.label} driver
                      </span>
                    </div>
                  </div>

                  <div className="customer-driver-detail-grid">
                    <div>
                      <span>Phone</span>
                      <strong>{displayValue(driver?.phone)}</strong>
                    </div>
                    <div>
                      <span>Vehicle</span>
                      <strong>{carText}</strong>
                    </div>
                    <div>
                      <span>Plate</span>
                      <strong>{displayValue(driver?.vehicle_registration)}</strong>
                    </div>
                    <div>
                      <span>Status</span>
                      <strong>{tracking?.driverFresh ? "Online now" : "Updates pending"}</strong>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Completed trips</div>
                      <div className="mt-1 text-sm font-black text-slate-900">
                        {Number(driver?.completed_trips_count ?? 0)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Driver rating</div>
                      <div className="mt-1 text-sm font-black text-slate-900">
                        {driverRatingLabel(driver)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tracking && canShowDriverDetails && (
                <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">
                  Driver location updates automatically while your trip is active.
                </div>
              )}

              {canShowDriverDetails && driver?.phone && (
                <a href={`tel:${driver.phone}`} className="moovu-btn moovu-btn-primary mt-4 w-full">
                  Call driver
                </a>
              )}

            </section>

            <section className="moovu-card p-5">
              <div className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Next step</div>
              <div className="mt-4 grid gap-3">
                {startOtpAvailable && (
                  <button
                    type="button"
                    className="moovu-btn moovu-btn-primary w-full"
                    onClick={() => setActiveOtpModal("start")}
                  >
                    View Start OTP
                  </button>
                )}

                {trip.status === "ongoing" && !endOtpReady && !trip.end_otp_verified && (
                  <div className="rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                    End OTP unlocks in {endOtpCountdown || "a moment"}.
                  </div>
                )}

                {endOtpAvailable && (
                  <button
                    type="button"
                    className="moovu-btn moovu-btn-primary w-full"
                    onClick={() => setActiveOtpModal("end")}
                  >
                    View End OTP
                  </button>
                )}

                {trip.status === "completed" && (
                  <button
                    type="button"
                    onClick={() => router.push("/")}
                    className="moovu-btn moovu-btn-primary w-full"
                  >
                    Done
                  </button>
                )}
              </div>
            </section>
          </aside>
        </div>

        <div className="mt-4 hidden">
          <section className="customer-route-summary-card">
            <div>
              <div className="moovu-section-title">Route summary</div>
              <h2 className="mt-2 text-2xl font-black text-slate-950">Pickup to destination</h2>
            </div>
            <div className="customer-route-summary-list">
              <div>
                <span className="pickup" />
                <div>
                  <strong>Pickup</strong>
                  <p>{displayValue(trip.pickup_address)}</p>
                </div>
              </div>
              {tripStops.map((stop, index) => (
                <div key={`${stop.address}-${index}-summary`}>
                  <span className="stop">{index + 1}</span>
                  <div>
                    <strong>Stop {index + 1}</strong>
                    <p>{displayValue(stop.address)}</p>
                  </div>
                </div>
              ))}
              <div>
                <span className="dropoff" />
                <div>
                  <strong>Destination</strong>
                  <p>{displayValue(trip.dropoff_address)}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="moovu-card mt-4 p-5">
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

            {rating ? (
              <div className="mt-5 rounded-2xl bg-slate-100 p-4 text-slate-900">
                <div className="text-sm text-slate-500">Your rating</div>
                <div className="mt-1 text-2xl font-semibold">{rating.rating} / 5</div>
                {rating.comment && (
                  <div className="mt-2 text-sm text-slate-700">{rating.comment}</div>
                )}
              </div>
            ) : trip.status === "completed" ? (
              <div className="mt-5 rounded-2xl bg-slate-100 p-4 text-sm font-semibold text-slate-700">
                Rating feature coming soon. You can still use the Rate driver button if ratings are enabled for this trip.
              </div>
            ) : null}
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
