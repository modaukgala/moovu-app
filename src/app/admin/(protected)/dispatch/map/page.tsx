"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

  async function loadBoardMap() {
    const res = await fetch("/api/admin/dispatch/map");
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
  }

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

    // Driver markers
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

    // Trip pickup markers
    for (const t of trips) {
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
              <a href="/admin/trips/${t.id}" target="_blank" rel="noreferrer">Open trip</a>
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
  }, []);

  useEffect(() => {
    if (!loaded) return;
    renderMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, drivers, trips]);

  useEffect(() => {
    const t = setInterval(() => {
      loadBoardMap();
    }, 5000);

    return () => clearInterval(t);
  }, []);

  const stats = useMemo(() => {
    const onlineDrivers = drivers.length;
    const busyDrivers = drivers.filter((d) => d.busy).length;
    const activeTrips = trips.length;
    const offeredTrips = trips.filter((t) => t.status === "offered").length;

    return { onlineDrivers, busyDrivers, activeTrips, offeredTrips };
  }, [drivers, trips]);

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Live Driver Map</h1>
          <p className="opacity-70 mt-1">
            Track online drivers and active trip pickups live.
          </p>
        </div>

        <button className="border rounded-xl px-4 py-2" onClick={loadBoardMap}>
          Refresh
        </button>
      </div>

      {msg && <div className="border rounded-2xl p-4 text-sm">{msg}</div>}

      <section className="grid md:grid-cols-4 gap-4">
        <div className="border rounded-2xl p-4">
          <div className="text-sm opacity-70">Online drivers</div>
          <div className="text-2xl font-semibold mt-1">{stats.onlineDrivers}</div>
        </div>

        <div className="border rounded-2xl p-4">
          <div className="text-sm opacity-70">Busy drivers</div>
          <div className="text-2xl font-semibold mt-1">{stats.busyDrivers}</div>
        </div>

        <div className="border rounded-2xl p-4">
          <div className="text-sm opacity-70">Active trips</div>
          <div className="text-2xl font-semibold mt-1">{stats.activeTrips}</div>
        </div>

        <div className="border rounded-2xl p-4">
          <div className="text-sm opacity-70">Offered trips</div>
          <div className="text-2xl font-semibold mt-1">{stats.offeredTrips}</div>
        </div>
      </section>

      <section className="border rounded-2xl p-4">
        <div ref={mapRef} className="w-full h-[70vh] rounded-2xl" />
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="border rounded-2xl p-4">
          <h2 className="font-semibold">Online Drivers</h2>
          <div className="mt-3 space-y-2 max-h-[320px] overflow-auto">
            {drivers.length === 0 ? (
              <div className="text-sm opacity-60">No online drivers</div>
            ) : (
              drivers.map((d) => (
                <div key={d.id} className="border rounded-xl p-3">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs opacity-60">
                    {d.phone ?? "—"} • {d.busy ? "busy" : "free"} • {d.subscription_status ?? "—"}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border rounded-2xl p-4">
          <h2 className="font-semibold">Active Trips</h2>
          <div className="mt-3 space-y-2 max-h-[320px] overflow-auto">
            {trips.length === 0 ? (
              <div className="text-sm opacity-60">No active trips</div>
            ) : (
              trips.map((t) => (
                <div key={t.id} className="border rounded-xl p-3">
                  <div className="font-medium">Trip {t.id.slice(0, 8)}</div>
                  <div className="text-xs opacity-60">
                    {t.status} • {t.offer_status ?? "—"} • R{t.fare_amount ?? "—"}
                  </div>
                  <div className="text-xs opacity-70 mt-1">{t.pickup_address ?? "—"}</div>
                  <div className="text-xs opacity-70">{t.dropoff_address ?? "—"}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}