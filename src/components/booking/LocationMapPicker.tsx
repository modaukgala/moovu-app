"use client";

import { useEffect, useRef, useState } from "react";
import {
  bestReverseGeocodeLabel,
  type ReverseGeocodeResult,
} from "@/lib/locationPaste";

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
  defaultCenter: { lat: number; lng: number };
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
  defaultCenter,
  initialPickupInstruction = "",
  onClose,
  onConfirm,
}: LocationMapPickerProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const onCloseRef = useRef(onClose);
  const reverseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSequenceRef = useRef(0);
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
    if (!mapsReady || !mapNodeRef.current || !window.google?.maps) return;

    const hasInitialLocation = typeof initialLat === "number" && typeof initialLng === "number";
    const initialCenter = hasInitialLocation
      ? { lat: initialLat, lng: initialLng }
      : { lat: defaultLat, lng: defaultLng };
    const map = new window.google.maps.Map(mapNodeRef.current, {
      center: initialCenter,
      zoom: hasInitialLocation ? 17 : 13,
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

    return () => {
      idleListener.remove();
      clickListener.remove();
      if (reverseTimerRef.current) clearTimeout(reverseTimerRef.current);
      requestSequenceRef.current += 1;
      mapRef.current = null;
    };
  }, [
    defaultLat,
    defaultLng,
    initialLat,
    initialLng,
    kind,
    mapsReady,
  ]);

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
