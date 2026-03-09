"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";

type Offer = {
  id: string;
  status: string;
  offer_status: string;
  offer_expires_at: string | null;
  pickup_address: string;
  dropoff_address: string;
  fare_amount: number | null;
};

type ActiveTrip = {
  id: string;
  status: string;
  driver_id: string | null;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  fare_amount: number | null;
  payment_method: string | null;
  created_at: string;
  offer_status?: string | null;
  offer_expires_at?: string | null;
};

type Driver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email?: string | null;
  status: string | null;
  online: boolean | null;
  busy: boolean | null;
  subscription_status?: string | null;
  subscription_expires_at?: string | null;
  subscription_plan?: string | null;
  lat: number | null;
  lng: number | null;
  last_seen: string | null;
};

declare global {
  interface Window {
    google: typeof google;
  }
}

function googleMapsLink(lat: number | null | undefined, lng: number | null | undefined) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
}

function wazeLink(lat: number | null | undefined, lng: number | null | undefined) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return `https://waze.com/ul?ll=${encodeURIComponent(`${lat},${lng}`)}&navigate=yes`;
}

export default function DriverHomePage() {
  const router = useRouter();

  const [driver, setDriver] = useState<Driver | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [currentTrip, setCurrentTrip] = useState<ActiveTrip | null>(null);

  const [locationName, setLocationName] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [gpsInfo, setGpsInfo] = useState<string | null>(null);

  const [tick, setTick] = useState(0);

  const pollTimerRef = useRef<any>(null);
  const gpsTimerRef = useRef<any>(null);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function requireSession() {
    const { data } = await supabaseClient.auth.getSession();
    if (!data.session) {
      router.replace("/driver/login");
      return null;
    }
    return data.session;
  }

  async function getAccessToken() {
    const { data } = await supabaseClient.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function loadDriverFromMapping() {
    const session = await requireSession();
    if (!session) return;

    const { data: mapping, error: mErr } = await supabaseClient
      .from("driver_accounts")
      .select("driver_id")
      .single();

    if (mErr || !mapping?.driver_id) {
      setInfo("Your account is not linked yet. Please wait for admin to approve + link your account.");
      setDriver(null);
      return;
    }

    const driverId = mapping.driver_id;

    const { data: d, error: dErr } = await supabaseClient
      .from("drivers")
      .select(
        "id,first_name,last_name,phone,email,status,online,busy,subscription_status,subscription_expires_at,subscription_plan,lat,lng,last_seen"
      )
      .eq("id", driverId)
      .single();

    if (dErr || !d) {
      setInfo("Driver record not found for your account mapping.");
      setDriver(null);
      return;
    }

    setDriver(d as any);
  }

  async function pollOffers() {
    const token = await getAccessToken();
    if (!token) {
      setOffers([]);
      setInfo("Not logged in");
      return;
    }

    const res = await fetch("/api/driver/offers/poll", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json();

    if (!json.ok) {
      setOffers([]);
      setInfo(json.error || "Failed to poll offers");
      return;
    }

    if (json.info) setInfo(String(json.info));
    setOffers(json.offers ?? []);
  }

  async function loadCurrentTrip() {
    const token = await getAccessToken();
    if (!token) {
      setCurrentTrip(null);
      return;
    }

    const res = await fetch("/api/driver/trips/current", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json();
    if (!json.ok) {
      setCurrentTrip(null);
      return;
    }

    setCurrentTrip(json.trip ?? null);
  }

  async function setOnlineServer(wantOnline: boolean) {
    setBusy(true);
    setInfo(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      setInfo("Not logged in");
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

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setInfo(json.error || "Failed to update online status");
      await loadDriverFromMapping();
      return;
    }

    setInfo(wantOnline ? "You are online ✅" : "You are offline ✅");
    await loadDriverFromMapping();
    await pollOffers();
    await loadCurrentTrip();
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

    const json = await res.json();

    if (!json.ok) {
      setBusy(false);
      setInfo(json.error || "Location not found");
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
    await loadDriverFromMapping();
  }

  async function sendHeartbeat(lat: number, lng: number) {
    const token = await getAccessToken();
    if (!token) return;

    const res = await fetch("/api/driver/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ lat, lng }),
    });

    const json = await res.json();
    if (!json.ok) {
      setGpsInfo(json.error || "Heartbeat failed");
      return;
    }

    setGpsInfo(`GPS live • ${new Date().toLocaleTimeString()}`);
  }

  async function heartbeatNow() {
    if (!navigator.geolocation) {
      setGpsInfo("GPS not supported");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await sendHeartbeat(pos.coords.latitude, pos.coords.longitude);
        await loadDriverFromMapping();
      },
      (err) => {
        setGpsInfo(`GPS error: ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      }
    );
  }

  async function respond(tripId: string, action: "accept" | "reject") {
    setBusy(true);
    setInfo(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      setInfo("Not logged in");
      return;
    }

    const res = await fetch("/api/driver/offers/respond", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tripId, action }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setInfo(json.error || "Failed to respond");
      await pollOffers();
      await loadDriverFromMapping();
      await loadCurrentTrip();
      return;
    }

    setInfo(action === "accept" ? "Offer accepted ✅" : "Offer rejected ✅");
    await pollOffers();
    await loadDriverFromMapping();
    await loadCurrentTrip();
  }

  async function tripAction(endpoint: string, tripId: string, successMsg: string) {
    setBusy(true);
    setInfo(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      setInfo("Not logged in");
      return;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tripId }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setInfo(json.error || "Action failed");
      await loadCurrentTrip();
      await loadDriverFromMapping();
      return;
    }

    setInfo(successMsg);
    await loadCurrentTrip();
    await loadDriverFromMapping();
    await pollOffers();
  }

  async function arriveTrip(tripId: string) {
    await tripAction("/api/driver/trips/arrive", tripId, "Marked as arrived ✅");
  }

  async function startTrip(tripId: string) {
    await tripAction("/api/driver/trips/start", tripId, "Trip started ✅");
  }

  async function completeTrip(tripId: string) {
    await tripAction("/api/driver/trips/complete", tripId, "Trip completed ✅");
  }

  async function logout() {
    await supabaseClient.auth.signOut();
    router.replace("/driver/login");
  }

  function clearMap() {
    if (driverMarkerRef.current) driverMarkerRef.current.setMap(null);
    if (pickupMarkerRef.current) pickupMarkerRef.current.setMap(null);
    if (dropoffMarkerRef.current) dropoffMarkerRef.current.setMap(null);
    if (directionsRendererRef.current) directionsRendererRef.current.setMap(null);

    driverMarkerRef.current = null;
    pickupMarkerRef.current = null;
    dropoffMarkerRef.current = null;
    directionsRendererRef.current = null;
  }

  function renderDriverMap() {
    const map = mapInstanceRef.current;
    if (!map || !window.google) return;

    clearMap();

    const bounds = new window.google.maps.LatLngBounds();

    if (driver && typeof driver.lat === "number" && typeof driver.lng === "number") {
      driverMarkerRef.current = new window.google.maps.Marker({
        map,
        position: { lat: driver.lat, lng: driver.lng },
        title: "You",
        label: { text: "Y", color: "white", fontWeight: "bold" },
      });

      bounds.extend({ lat: driver.lat, lng: driver.lng });
    }

    if (currentTrip?.pickup_lat != null && currentTrip?.pickup_lng != null) {
      pickupMarkerRef.current = new window.google.maps.Marker({
        map,
        position: { lat: currentTrip.pickup_lat, lng: currentTrip.pickup_lng },
        title: "Pickup",
        label: { text: "P", color: "white", fontWeight: "bold" },
      });

      bounds.extend({ lat: currentTrip.pickup_lat, lng: currentTrip.pickup_lng });
    }

    if (currentTrip?.dropoff_lat != null && currentTrip?.dropoff_lng != null) {
      dropoffMarkerRef.current = new window.google.maps.Marker({
        map,
        position: { lat: currentTrip.dropoff_lat, lng: currentTrip.dropoff_lng },
        title: "Dropoff",
        label: { text: "D", color: "white", fontWeight: "bold" },
      });

      bounds.extend({ lat: currentTrip.dropoff_lat, lng: currentTrip.dropoff_lng });
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds);
      window.setTimeout(() => {
        if (map.getZoom() && map.getZoom()! > 15) map.setZoom(15);
      }, 300);
    }

    const hasOrigin = driver?.lat != null && driver?.lng != null;
    const goingToPickup = currentTrip?.status === "assigned";
    const goingToDropoff = currentTrip?.status === "arrived" || currentTrip?.status === "started";

    let destLat: number | null = null;
    let destLng: number | null = null;

    if (goingToPickup) {
      destLat = currentTrip?.pickup_lat ?? null;
      destLng = currentTrip?.pickup_lng ?? null;
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
          origin: { lat: driver!.lat!, lng: driver!.lng! },
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

  useEffect(() => {
    (async () => {
      await loadDriverFromMapping();
      await pollOffers();
      await loadCurrentTrip();
    })();
  }, []);

  useEffect(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;

    if (!driver?.online) return;

    pollTimerRef.current = setInterval(() => {
      pollOffers();
      loadCurrentTrip();
    }, 2000);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [driver?.online]);

  useEffect(() => {
    if (gpsTimerRef.current) clearInterval(gpsTimerRef.current);
    gpsTimerRef.current = null;

    if (!driver?.online) {
      setGpsInfo(null);
      return;
    }

    heartbeatNow();

    gpsTimerRef.current = setInterval(() => {
      heartbeatNow();
    }, 20000);

    return () => {
      if (gpsTimerRef.current) clearInterval(gpsTimerRef.current);
      gpsTimerRef.current = null;
    };
  }, [driver?.online]);

  useEffect(() => {
    let cancelled = false;

    function initMap() {
      if (!mapRef.current || !window.google) return;

      mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
        center: { lat: -25.12, lng: 29.05 },
        zoom: 12,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
      });

      if (!cancelled) setMapReady(true);
    }

    if (window.google?.maps) {
      initMap();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""
    )}`;
    script.async = true;
    script.defer = true;
    script.onload = initMap;
    document.body.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    renderDriverMap();
  }, [mapReady, driver, currentTrip]);

  const topOffer = offers[0];

  const secondsLeft = useMemo(() => {
    if (!topOffer?.offer_expires_at) return null;
    return Math.max(0, Math.ceil((new Date(topOffer.offer_expires_at).getTime() - Date.now()) / 1000));
  }, [topOffer?.offer_expires_at, tick]);

  const subscriptionLabel = useMemo(() => {
    if (!driver) return "—";
    const st = driver.subscription_status ?? "unknown";
    const plan = driver.subscription_plan ? ` (${driver.subscription_plan})` : "";
    const exp = driver.subscription_expires_at
      ? ` • expires ${new Date(driver.subscription_expires_at).toLocaleDateString()}`
      : "";
    return `${st}${plan}${exp}`;
  }, [driver]);

  const pickupGoogle = googleMapsLink(currentTrip?.pickup_lat, currentTrip?.pickup_lng);
  const pickupWaze = wazeLink(currentTrip?.pickup_lat, currentTrip?.pickup_lng);
  const dropoffGoogle = googleMapsLink(currentTrip?.dropoff_lat, currentTrip?.dropoff_lng);
  const dropoffWaze = wazeLink(currentTrip?.dropoff_lat, currentTrip?.dropoff_lng);

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm border bg-white/85 mb-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--moovu-primary)" }} />
              Driver operations
            </div>
            <h1 className="text-3xl md:text-4xl font-semibold">Driver Dashboard</h1>
            <p className="opacity-70 mt-2">Trip controls, live map and navigation in one place.</p>
          </div>

          <button
            className="rounded-xl px-4 py-2 text-white"
            style={{ background: "var(--moovu-primary)" }}
            onClick={logout}
          >
            Logout
          </button>
        </div>

        {info && (
          <div className="border rounded-2xl p-4 text-sm" style={{ background: "var(--moovu-primary-soft)" }}>
            {info}
          </div>
        )}

        {gpsInfo && (
          <div className="border rounded-2xl p-4 text-sm bg-white/85">
            {gpsInfo}
          </div>
        )}

        {!driver ? (
          <div className="border rounded-2xl p-5 bg-white/85 opacity-70">Loading driver...</div>
        ) : (
          <>
            <section className="border rounded-[2rem] p-6 bg-white/90">
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h2 className="text-xl font-semibold">Profile</h2>

                  <div className="text-sm opacity-75">
                    {driver.first_name ?? "—"} {driver.last_name ?? ""} • {driver.phone ?? "—"}
                  </div>

                  <div className="text-sm opacity-75">
                    Approval status: <span className="font-medium">{driver.status ?? "—"}</span>
                    {" • "}
                    Subscription: <span className="font-medium">{subscriptionLabel}</span>
                  </div>

                  <div className="text-sm opacity-75">
                    Online: <span className="font-medium">{driver.online ? "Yes" : "No"}</span>
                    {" • "}
                    Busy: <span className="font-medium">{driver.busy ? "Yes" : "No"}</span>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      className="rounded-xl px-4 py-2 text-white"
                      style={{ background: "var(--moovu-primary)" }}
                      disabled={busy}
                      onClick={() => setOnlineServer(true)}
                    >
                      Go Online
                    </button>

                    <button
                      className="border rounded-xl px-4 py-2 bg-white"
                      disabled={busy}
                      onClick={() => setOnlineServer(false)}
                    >
                      Go Offline
                    </button>

                    <button
                      className="border rounded-xl px-4 py-2 bg-white"
                      disabled={busy}
                      onClick={() => {
                        pollOffers();
                        loadCurrentTrip();
                        heartbeatNow();
                      }}
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <h2 className="text-xl font-semibold">Location</h2>

                  <input
                    className="rounded-xl p-3 w-full"
                    placeholder="Update location manually"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                  />

                  <button
                    className="border rounded-xl px-4 py-2 bg-white"
                    disabled={busy}
                    onClick={saveLocationFromName}
                  >
                    Save Location Manually
                  </button>

                  <div className="text-xs opacity-60">
                    Current coords: {driver.lat != null && driver.lng != null ? `${driver.lat}, ${driver.lng}` : "—"}
                  </div>
                </div>
              </div>
            </section>

            <section className="border rounded-[2rem] p-5 bg-white/90">
              <h2 className="text-xl font-semibold mb-4">Driver Map</h2>
              <div ref={mapRef} className="w-full h-[55vh] rounded-[1.5rem]" />
            </section>

            <section className="border rounded-[2rem] p-6 bg-white/90 space-y-4">
              <h2 className="text-xl font-semibold">Current Trip</h2>

              {!currentTrip ? (
                <p className="opacity-70">No active trip.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="border rounded-2xl p-4" style={{ background: "var(--moovu-primary-soft)" }}>
                      <div className="text-sm opacity-60">Pickup</div>
                      <div className="font-medium mt-1">{currentTrip.pickup_address}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm opacity-60">Dropoff</div>
                      <div className="font-medium mt-1">{currentTrip.dropoff_address}</div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm opacity-60">Status</div>
                      <div className="font-semibold mt-1">{currentTrip.status}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm opacity-60">Fare</div>
                      <div className="font-semibold mt-1">R{currentTrip.fare_amount ?? "—"}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm opacity-60">Payment</div>
                      <div className="font-semibold mt-1">{currentTrip.payment_method ?? "—"}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {pickupGoogle && (
                      <a className="border rounded-xl px-4 py-2 bg-white" href={pickupGoogle} target="_blank" rel="noreferrer">
                        Pickup Google Maps
                      </a>
                    )}

                    {pickupWaze && (
                      <a className="border rounded-xl px-4 py-2 bg-white" href={pickupWaze} target="_blank" rel="noreferrer">
                        Pickup Waze
                      </a>
                    )}

                    {dropoffGoogle && (
                      <a className="border rounded-xl px-4 py-2 bg-white" href={dropoffGoogle} target="_blank" rel="noreferrer">
                        Dropoff Google Maps
                      </a>
                    )}

                    {dropoffWaze && (
                      <a className="border rounded-xl px-4 py-2 bg-white" href={dropoffWaze} target="_blank" rel="noreferrer">
                        Dropoff Waze
                      </a>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {currentTrip.status === "assigned" && (
                      <>
                        <button
                          className="rounded-xl px-4 py-2 text-white"
                          style={{ background: "var(--moovu-primary)" }}
                          disabled={busy}
                          onClick={() => arriveTrip(currentTrip.id)}
                        >
                          Arrived
                        </button>

                        <button
                          className="border rounded-xl px-4 py-2 bg-white"
                          disabled={busy}
                          onClick={() => startTrip(currentTrip.id)}
                        >
                          Start Trip
                        </button>
                      </>
                    )}

                    {currentTrip.status === "arrived" && (
                      <>
                        <button
                          className="rounded-xl px-4 py-2 text-white"
                          style={{ background: "var(--moovu-primary)" }}
                          disabled={busy}
                          onClick={() => startTrip(currentTrip.id)}
                        >
                          Start Trip
                        </button>

                        <button
                          className="border rounded-xl px-4 py-2 bg-white"
                          disabled={busy}
                          onClick={() => completeTrip(currentTrip.id)}
                        >
                          Complete Trip
                        </button>
                      </>
                    )}

                    {currentTrip.status === "started" && (
                      <button
                        className="rounded-xl px-4 py-2 text-white"
                        style={{ background: "var(--moovu-primary)" }}
                        disabled={busy}
                        onClick={() => completeTrip(currentTrip.id)}
                      >
                        Complete Trip
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="border rounded-[2rem] p-6 bg-white/90 space-y-4">
              <h2 className="text-xl font-semibold">Current Offer</h2>

              {!topOffer ? (
                <p className="opacity-70">No pending offers.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="border rounded-2xl p-4" style={{ background: "var(--moovu-primary-soft)" }}>
                      <div className="text-sm opacity-60">Pickup</div>
                      <div className="font-medium mt-1">{topOffer.pickup_address}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm opacity-60">Dropoff</div>
                      <div className="font-medium mt-1">{topOffer.dropoff_address}</div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm opacity-60">Offer status</div>
                      <div className="font-semibold mt-1">{topOffer.offer_status}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm opacity-60">Fare</div>
                      <div className="font-semibold mt-1">R{topOffer.fare_amount ?? "—"}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm opacity-60">Time left</div>
                      <div className="font-semibold mt-1">{secondsLeft != null ? `${secondsLeft}s` : "—"}</div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      className="rounded-xl px-4 py-2 text-white"
                      style={{ background: "var(--moovu-primary)" }}
                      disabled={busy || secondsLeft === 0}
                      onClick={() => respond(topOffer.id, "accept")}
                    >
                      Accept
                    </button>

                    <button
                      className="border rounded-xl px-4 py-2 bg-white"
                      disabled={busy || secondsLeft === 0}
                      onClick={() => respond(topOffer.id, "reject")}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}