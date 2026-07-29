"use client";

import { useEffect, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import {
  bestReverseGeocodeLabel,
  type ReverseGeocodeResult,
} from "@/lib/locationPaste";
import { isValidMapLocation } from "@/lib/location/bookingMapLocation";

export type ConfirmedMapLocation = {
  address: string;
  placeId: string;
  lat: number;
  lng: number;
};

type LocationMapPickerProps = {
  kind: "pickup" | "dropoff";
  mapsReady: boolean;
  initialLocation: { lat: number; lng: number } | null;
  liveLocation: { lat: number; lng: number } | null;
  defaultCenter: { lat: number; lng: number };
  defaultZoom: number;
  allowLateLiveRecenter: boolean;
  initialPickupInstruction?: string;
  onClose: () => void;
  onConfirm: (location: ConfirmedMapLocation, pickupInstruction: string) => void;
};

function fallbackLabel(kind: "pickup" | "dropoff") {
  return kind === "pickup" ? "Pinned pickup location" : "Pinned destination";
}

export default function LocationMapPicker({
  kind,
  mapsReady,
  initialLocation,
  liveLocation,
  defaultCenter,
  defaultZoom,
  allowLateLiveRecenter,
  initialPickupInstruction = "",
  onClose,
  onConfirm,
}: LocationMapPickerProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const onCloseRef = useRef(onClose);
  const reverseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSequenceRef = useRef(0);
  const userMovedMapRef = useRef(false);
  const appliedLateLiveLocationRef = useRef(false);
  const liveLocationRef = useRef(liveLocation);
  const allowLateLiveRecenterRef = useRef(allowLateLiveRecenter);
  liveLocationRef.current = liveLocation;
  allowLateLiveRecenterRef.current = allowLateLiveRecenter;
  const defaultLat = defaultCenter.lat;
  const defaultLng = defaultCenter.lng;
  const initialLat = initialLocation?.lat;
  const initialLng = initialLocation?.lng;
  const [center, setCenter] = useState(initialLocation ?? defaultCenter);
  const [label, setLabel] = useState(fallbackLabel(kind));
  const [placeId, setPlaceId] = useState("");
  const [resolving, setResolving] = useState(false);
  const [pickupInstruction, setPickupInstruction] = useState(initialPickupInstruction);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const mapNode = mapNodeRef.current;
    if (!mapsReady || !mapNode || !window.google?.maps) return;

    const hasInitialLocation = typeof initialLat === "number" && typeof initialLng === "number";
    const liveLocationAtInitialization =
      allowLateLiveRecenterRef.current && isValidMapLocation(liveLocationRef.current)
        ? liveLocationRef.current
        : null;
    const initialCenter = hasInitialLocation
      ? { lat: initialLat, lng: initialLng }
      : liveLocationAtInitialization
        ? { lat: liveLocationAtInitialization.lat, lng: liveLocationAtInitialization.lng }
      : { lat: defaultLat, lng: defaultLng };
    if (liveLocationAtInitialization) {
      appliedLateLiveLocationRef.current = true;
    }
    const map = new window.google.maps.Map(mapNode, {
      center: initialCenter,
      zoom: hasInitialLocation || liveLocationAtInitialization ? 17 : defaultZoom,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
      gestureHandling: "greedy",
      clickableIcons: false,
    });
    mapRef.current = map;
    setCenter(initialCenter);

    const resolveCenter = (nextCenter: { lat: number; lng: number }) => {
      if (reverseTimerRef.current) clearTimeout(reverseTimerRef.current);
      const requestSequence = ++requestSequenceRef.current;
      setResolving(true);

      reverseTimerRef.current = setTimeout(async () => {
        try {
          const response = await fetch("/api/maps/reverse-geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(nextCenter),
          });
          const result = (await response.json().catch(() => null)) as ReverseGeocodeResult | null;
          if (requestSequence !== requestSequenceRef.current) return;

          if (response.ok && result?.ok) {
            setLabel(bestReverseGeocodeLabel(result, fallbackLabel(kind)));
            setPlaceId(result.placeId?.trim() ?? "");
          } else {
            setLabel(fallbackLabel(kind));
            setPlaceId("");
          }
        } catch {
          if (requestSequence !== requestSequenceRef.current) return;
          setLabel(fallbackLabel(kind));
          setPlaceId("");
        } finally {
          if (requestSequence === requestSequenceRef.current) setResolving(false);
        }
      }, 550);
    };

    const idleListener = map.addListener("idle", () => {
      const mapCenter = map.getCenter();
      if (!mapCenter) return;
      const nextCenter = { lat: mapCenter.lat(), lng: mapCenter.lng() };
      setCenter(nextCenter);
      resolveCenter(nextCenter);
    });

    const clickListener = map.addListener("click", (event: google.maps.MapMouseEvent) => {
      if (event.latLng) map.panTo(event.latLng);
    });
    const dragStartListener = map.addListener("dragstart", () => {
      userMovedMapRef.current = true;
    });
    const markManualInteraction = () => {
      userMovedMapRef.current = true;
    };
    mapNode.addEventListener("pointerdown", markManualInteraction);
    mapNode.addEventListener("wheel", markManualInteraction, { passive: true });

    return () => {
      idleListener.remove();
      clickListener.remove();
      dragStartListener.remove();
      mapNode.removeEventListener("pointerdown", markManualInteraction);
      mapNode.removeEventListener("wheel", markManualInteraction);
      if (reverseTimerRef.current) clearTimeout(reverseTimerRef.current);
      requestSequenceRef.current += 1;
      mapRef.current = null;
    };
  }, [
    defaultLat,
    defaultLng,
    defaultZoom,
    initialLat,
    initialLng,
    kind,
    mapsReady,
  ]);

  useEffect(() => {
    if (
      !allowLateLiveRecenter ||
      appliedLateLiveLocationRef.current ||
      userMovedMapRef.current ||
      !isValidMapLocation(liveLocation) ||
      !mapRef.current
    ) {
      return;
    }

    appliedLateLiveLocationRef.current = true;
    mapRef.current.panTo(liveLocation);
    mapRef.current.setZoom(17);
  }, [allowLateLiveRecenter, liveLocation, mapsReady]);

  function recenterOnLiveLocation() {
    if (!isValidMapLocation(liveLocation) || !mapRef.current) return;
    userMovedMapRef.current = true;
    mapRef.current.panTo(liveLocation);
    mapRef.current.setZoom(17);
  }

  return (
    <section
      className="moovu-location-picker"
      role="dialog"
      aria-modal="true"
      aria-label={kind === "pickup" ? "Set pickup location" : "Set destination"}
    >
      <header className="moovu-location-picker-header">
        <button type="button" className="moovu-location-picker-back" onClick={onClose} aria-label="Back to booking">
          <span aria-hidden="true">&larr;</span>
        </button>
        <div>
          <div className="moovu-kicker">Exact location</div>
          <h2>{kind === "pickup" ? "Set pickup location" : "Set destination"}</h2>
        </div>
      </header>

      <div className="moovu-location-picker-map-wrap">
        {!mapsReady && <div className="moovu-location-picker-loading">Loading map...</div>}
        <div ref={mapNodeRef} className="moovu-location-picker-map" />
        <div className={`moovu-location-picker-pin ${kind === "pickup" ? "is-pickup" : "is-dropoff"}`} aria-hidden="true">
          <span />
        </div>
        <button
          type="button"
          className="moovu-location-picker-recenter"
          disabled={!isValidMapLocation(liveLocation)}
          onClick={recenterOnLiveLocation}
          aria-label="Recenter map on my live location"
          title="My live location"
        >
          <LocateFixed aria-hidden="true" size={20} strokeWidth={2.2} />
        </button>
        <div className="moovu-location-picker-tip">Move the map to place the pin exactly</div>
      </div>

      <div className="moovu-location-picker-sheet">
        <div className="moovu-location-picker-handle" />
        <div className="moovu-field-label">
          {kind === "pickup" ? "Exact pickup location" : "Exact destination"}
        </div>
        <div className="moovu-location-picker-label" aria-live="polite">
          {resolving ? "Finding a nearby place..." : label}
        </div>
        <p className="moovu-location-picker-copy">
          The pin position is used for navigation, even when the address nearby is incomplete.
        </p>

        {kind === "pickup" && (
          <label className="moovu-location-picker-note">
            <span>Help your driver find you <small>Optional</small></span>
            <input
              value={pickupInstruction}
              maxLength={240}
              onChange={(event) => setPickupInstruction(event.target.value)}
              placeholder="Gate colour, stand number or nearby landmark"
            />
          </label>
        )}

        <button
          type="button"
          className="moovu-location-picker-confirm"
          disabled={!mapsReady}
          onClick={() =>
            onConfirm(
              {
                address: label || fallbackLabel(kind),
                placeId,
                lat: center.lat,
                lng: center.lng,
              },
              pickupInstruction.trim()
            )
          }
        >
          {kind === "pickup" ? "Confirm pickup" : "Confirm destination"}
        </button>
      </div>
    </section>
  );
}
