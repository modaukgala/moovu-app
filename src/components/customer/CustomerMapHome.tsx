"use client";

import { useEffect, useRef, useState } from "react";
import { Layers3, LocateFixed } from "lucide-react";

const DEFAULT_CENTER = { lat: -25.113, lng: 29.045 };

export default function CustomerMapHome() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const map = useRef<google.maps.Map | null>(null);
  const marker = useRef<google.maps.Marker | null>(null);
  const [mapType, setMapType] = useState<"roadmap" | "satellite">("roadmap");
  const [status, setStatus] = useState(() =>
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      ? "Finding your location..."
      : "Map preview",
  );
  useEffect(() => {
    let cancelled = false;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    function initialise() {
      if (cancelled || !mapNode.current || !window.google?.maps) return;
      map.current = new window.google.maps.Map(mapNode.current, { center: DEFAULT_CENTER, zoom: 13, disableDefaultUI: true, gestureHandling: "greedy" });
      if (!navigator.geolocation) { setStatus("Map ready"); return; }
      navigator.geolocation.getCurrentPosition(({ coords }) => {
        if (cancelled || !map.current) return;
        const position = { lat: coords.latitude, lng: coords.longitude };
        map.current.setCenter(position); map.current.setZoom(15);
        marker.current = new window.google.maps.Marker({ position, map: map.current, title: "Your location" });
        setStatus("Your area");
      }, () => setStatus("Explore nearby rides"), { enableHighAccuracy: true, timeout: 9000, maximumAge: 60_000 });
    }
    if (window.google?.maps) initialise();
    else if (apiKey) {
      const existing = document.getElementById("google-maps-script-customer-home") as HTMLScriptElement | null;
      if (existing) existing.addEventListener("load", initialise, { once: true });
      else { const script = document.createElement("script"); script.id = "google-maps-script-customer-home"; script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`; script.async = true; script.addEventListener("load", initialise, { once: true }); script.addEventListener("error", () => setStatus("Map unavailable"), { once: true }); document.head.appendChild(script); }
    }
    return () => { cancelled = true; marker.current?.setMap(null); };
  }, []);
  function centreLocation() { navigator.geolocation?.getCurrentPosition(({ coords }) => { const position = { lat: coords.latitude, lng: coords.longitude }; map.current?.panTo(position); map.current?.setZoom(15); marker.current?.setPosition(position); setStatus("Your area"); }); }
  function toggleMapType() { const next = mapType === "roadmap" ? "satellite" : "roadmap"; setMapType(next); map.current?.setMapTypeId(next); }
  return <div className="customer-home-map-wrap"><div ref={mapNode} className="customer-home-map" aria-label="MOOVU customer map" /><div className="customer-map-fallback" aria-hidden="true" /><div className="customer-map-status"><span />{status}</div><div className="customer-map-controls"><button type="button" onClick={centreLocation} aria-label="Centre your location"><LocateFixed /></button><button type="button" onClick={toggleMapType} aria-label="Change map style"><Layers3 /></button></div></div>;
}
