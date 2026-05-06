"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type DriverMarker = {
  id: string;
  name: string;
  phone: string | null;
  online: boolean | null;
  busy: boolean | null;
  status: string | null;
  subscription_status: string | null;
  lat: number;
  lng: number;
  last_seen: string | null;
};

type TripMarker = {
  id: string;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  fare_amount: number | null;
  status: string;
  offer_status: string | null;
  created_at: string;
  driver: {
    id: string;
    name: string;
    phone: string | null;
    online: boolean | null;
    busy: boolean | null;
    subscription_status: string | null;
  } | null;
};

declare global {
  interface Window {
    google: typeof google;
  }
}

export default function DispatchMapPage() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const driverMarkersRef = useRef<google.maps.Marker[]>([]);
  const tripMarkersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const [drivers, setDrivers] = useState<DriverMarker[]>([]);
  const [trips, setTrips] = useState<TripMarker[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }, []);

  const loadBoardMap = useCallback(async () => {
    const token = await getAccessToken();

    if (!token) {
      setMsg("Missing access token.");
      setDrivers([]);
      setTrips([]);
      return;
    }

    const res = await fetch("/api/admin/dispatch/map", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const json = await res.json();

    if (!json.ok) {
      setMsg(json.error || "Failed to load map data");
      setDrivers([]);
      setTrips([]);
      return;
    }

    setMsg(null);
    setDrivers(json.drivers ?? []);
    setTrips(json.trips ?? []);
  }, [getAccessToken]);

  function clearMarkers(arr: google.maps.Marker[]) {
    for (const m of arr) m.setMap(null);
    arr.length = 0;
  }

  function renderMarkers() {
    const map = mapInstanceRef.current;
    if (!map || !window.google) return;

    clearMarkers(driverMarkersRef.current);
    clearMarkers(tripMarkersRef.current);

    if (!infoWindowRef.current) {
      infoWindowRef.current = new window.google.maps.InfoWindow();
    }

    for (const d of drivers) {
      const marker = new window.google.maps.Marker({
        map,
        position: { lat: d.lat, lng: d.lng },
        title: d.name,
        label: {
          text: "D",
          color: "white",
          fontWeight: "bold",
        },
      });

      marker.addListener("click", () => {
        infoWindowRef.current?.setContent(`
          <div style="min-width:220px">
            <div style="font-weight:600">${d.name}</div>
            <div>Phone: ${d.phone ?? "—"}</div>
            <div>Status: ${d.status ?? "—"}</div>
            <div>Online: ${d.online ? "Yes" : "No"}</div>
            <div>Busy: ${d.busy ? "Yes" : "No"}</div>
            <div>Subscription: ${d.subscription_status ?? "—"}</div>
            <div>Last seen: ${d.last_seen ? new Date(d.last_seen).toLocaleString() : "—"}</div>
          </div>
        `);
        infoWindowRef.current?.open({ map, anchor: marker });
      });

      driverMarkersRef.current.push(marker);
    }

    for (const t of trips) {
      const tripUrl = `/admin/trips/${t.id}`;

      const marker = new window.google.maps.Marker({
        map,
        position: { lat: t.pickup_lat, lng: t.pickup_lng },
        title: `Trip ${t.id}`,
        label: {
          text: "T",
          color: "white",
          fontWeight: "bold",
        },
      });

      marker.addListener("click", () => {
        infoWindowRef.current?.setContent(`
          <div style="min-width:240px">
            <div style="font-weight:600">Trip ${t.id.slice(0, 8)}</div>
            <div>Pickup: ${t.pickup_address ?? "—"}</div>
            <div>Dropoff: ${t.dropoff_address ?? "—"}</div>
            <div>Fare: R${t.fare_amount ?? "—"}</div>
            <div>Status: ${t.status}</div>
            <div>Offer: ${t.offer_status ?? "—"}</div>
            <div>Driver: ${t.driver?.name ?? "Unassigned"}</div>
            <div style="margin-top:8px">
              <a href="${tripUrl}" target="_blank" rel="noreferrer">Open trip</a>
            </div>
          </div>
        `);
        infoWindowRef.current?.open({ map, anchor: marker });
      });

      tripMarkersRef.current.push(marker);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      await loadBoardMap();

      if (cancelled) return;

      if (!window.google) {
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
          process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""
        )}`;
        script.async = true;
        script.defer = true;

        script.onload = () => {
          if (cancelled || !mapRef.current) return;

          mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
            center: { lat: -25.12, lng: 29.05 },
            zoom: 11,
            mapTypeControl: true,
            streetViewControl: false,
            fullscreenControl: true,
          });

          setLoaded(true);
        };

        document.body.appendChild(script);
      } else {
        if (!mapRef.current) return;

        mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
          center: { lat: -25.12, lng: 29.05 },
          zoom: 11,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        });

        setLoaded(true);
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, [loadBoardMap]);

  useEffect(() => {
    if (!loaded) return;
    renderMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, drivers, trips]);

  useEffect(() => {
    const t = setInterval(() => {
      void loadBoardMap();
    }, 5000);

    return () => clearInterval(t);
  }, [loadBoardMap]);

  const stats = useMemo(() => {
    const onlineDrivers = drivers.length;
    const busyDrivers = drivers.filter((d) => d.busy).length;
    const activeTrips = trips.length;
    const offeredTrips = trips.filter((t) => t.status === "offered").length;

    return { onlineDrivers, busyDrivers, activeTrips, offeredTrips };
  }, [drivers, trips]);

  return (
    <main className="space-y-6 text-black">
      <section className="moovu-hero-panel p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-white/70">
              Dispatch visibility
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">
              Live driver map
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/74">
              Track online drivers and active trip pickup points in real time.
            </p>
          </div>

          <button className="moovu-btn bg-white text-slate-950" onClick={() => void loadBoardMap()}>
            Refresh map
          </button>
        </div>
      </section>

      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <section className="grid gap-4 md:grid-cols-4">
        <div className="moovu-stat-card">
          <div className="moovu-stat-label">Online drivers</div>
          <div className="moovu-stat-value">{stats.onlineDrivers}</div>
        </div>

        <div className="moovu-stat-card moovu-stat-card-primary">
          <div className="moovu-stat-label">Busy drivers</div>
          <div className="moovu-stat-value">{stats.busyDrivers}</div>
        </div>

        <div className="moovu-stat-card">
          <div className="moovu-stat-label">Active trips</div>
          <div className="moovu-stat-value">{stats.activeTrips}</div>
        </div>

        <div className="moovu-stat-card">
          <div className="moovu-stat-label">Offered trips</div>
          <div className="moovu-stat-value">{stats.offeredTrips}</div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[34px] border border-[var(--moovu-border)] bg-white p-3 shadow-md">
        <div ref={mapRef} className="h-[70vh] w-full rounded-[28px] bg-slate-100" />
      </section>
    </main>
  );
}
