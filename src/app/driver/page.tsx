"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";

type Offer = {
  id: string;
  status: string;
  offer_status: string;
  offer_expires_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
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

export default function DriverHomePage() {
  const router = useRouter();

  const [driver, setDriver] = useState<Driver | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [currentTrip, setCurrentTrip] = useState<CurrentTrip | null>(null);

  const [locationName, setLocationName] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [gpsInfo, setGpsInfo] = useState<string | null>(null);
  const [loadingDriver, setLoadingDriver] = useState(true);
  const [tick, setTick] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);

  const [startOtp, setStartOtp] = useState("");
  const [showStartOtp, setShowStartOtp] = useState(false);
  const [endOtp, setEndOtp] = useState("");
  const [showEndOtp, setShowEndOtp] = useState(false);

  const otpEntryOpen = showStartOtp || showEndOtp;

  const offersTimerRef = useRef<any>(null);
  const tripTimerRef = useRef<any>(null);
  const gpsTimerRef = useRef<any>(null);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const mapInitializedRef = useRef(false);
  const mapContainerNodeRef = useRef<HTMLDivElement | null>(null);

  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
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
      setInfo("Complete your application before going online.");
      return;
    }

    setBusy(true);
    setInfo(null);

    if (wantOnline) {
      await captureCurrentLocationAndSave(true);
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
      setInfo(json?.error || "Failed to update online status");
      await loadDriverProfile(true);
      return;
    }

    setInfo(wantOnline ? "You are online ✅" : "You are offline ✅");
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
      setGpsInfo(json?.error || "Heartbeat failed");
      return false;
    }

    setGpsInfo(`GPS live • ${new Date().toLocaleTimeString()}`);
    return true;
  }

  async function captureCurrentLocationAndSave(silent = false) {
    return new Promise<boolean>((resolve) => {
      if (!navigator.geolocation) {
        setGpsInfo("GPS not supported");
        resolve(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const ok = await sendHeartbeat(pos.coords.latitude, pos.coords.longitude);
          await loadDriverProfile(silent);
          resolve(ok);
        },
        (err) => {
          setGpsInfo(`GPS error: ${err.message}`);
          resolve(false);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 5000,
        }
      );
    });
  }

  async function respondToOffer(action: "accept" | "reject") {
    if (!offer) return;

    setBusy(true);
    setInfo(null);

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
      setInfo(json?.error || "Failed to respond to offer.");
      await loadCurrentOffer();
      await loadCurrentTrip();
      return;
    }

    setInfo(action === "accept" ? "Offer accepted ✅" : "Offer declined ✅");
    await loadCurrentOffer();
    await loadCurrentTrip();
    await loadDriverProfile(true);
  }

  async function tripAction(
    endpoint: string,
    payload: Record<string, any>,
    successMsg: string
  ) {
    setBusy(true);
    setInfo(null);

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
      setInfo(json?.error || "Action failed");
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

  async function logout() {
    try {
      await supabaseClient.auth.signOut({ scope: "local" });
    } catch {}
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

    if (currentTrip?.pickup_lat != null && currentTrip?.pickup_lng != null) {
      const pickupPos = { lat: currentTrip.pickup_lat, lng: currentTrip.pickup_lng };
      pickupMarkerRef.current = new window.google.maps.Marker({
        map,
        position: pickupPos,
        title: "Pickup",
        label: "P",
      });
      bounds.extend(pickupPos);
      hasAnyPoint = true;
    }

    if (currentTrip?.dropoff_lat != null && currentTrip?.dropoff_lng != null) {
      const dropoffPos = { lat: currentTrip.dropoff_lat, lng: currentTrip.dropoff_lng };
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
    const goingToPickup = currentTrip?.status === "assigned";
    const goingToDropoff =
      currentTrip?.status === "arrived" || currentTrip?.status === "ongoing";

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
  }, [driver?.online, otpEntryOpen]);

  useEffect(() => {
    if (gpsTimerRef.current) clearInterval(gpsTimerRef.current);

    if (!driver?.online) {
      setGpsInfo(null);
      return;
    }

    captureCurrentLocationAndSave(true);

    gpsTimerRef.current = setInterval(() => {
      captureCurrentLocationAndSave(true);
    }, 5000);

    return () => {
      if (gpsTimerRef.current) clearInterval(gpsTimerRef.current);
    };
  }, [driver?.online]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: any = null;

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
    if (!apiKey) {
      setMapError("Google Maps API key is missing.");
      return;
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
  }, []);

  useEffect(() => {
    if (!mapInitializedRef.current) return;
    updateMapObjects();
  }, [
    driver?.lat,
    driver?.lng,
    currentTrip?.id,
    currentTrip?.status,
    currentTrip?.pickup_lat,
    currentTrip?.pickup_lng,
    currentTrip?.dropoff_lat,
    currentTrip?.dropoff_lng,
  ]);

  const secondsLeft = useMemo(() => {
    if (!offer?.offer_expires_at) return null;
    return Math.max(
      0,
      Math.ceil((new Date(offer.offer_expires_at).getTime() - Date.now()) / 1000)
    );
  }, [offer?.offer_expires_at, tick]);

  const pickupGoogle = googleMapsLink(currentTrip?.pickup_lat, currentTrip?.pickup_lng);
  const pickupWaze = wazeLink(currentTrip?.pickup_lat, currentTrip?.pickup_lng);
  const dropoffGoogle = googleMapsLink(currentTrip?.dropoff_lat, currentTrip?.dropoff_lng);
  const dropoffWaze = wazeLink(currentTrip?.dropoff_lat, currentTrip?.dropoff_lng);

  if (loadingDriver) {
    return (
      <main className="min-h-screen px-6 py-10 text-black">
        <div className="max-w-4xl mx-auto border rounded-[2rem] p-6 bg-white shadow-sm">
          Loading driver dashboard...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm border bg-white shadow-sm mb-3">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: "var(--moovu-primary)" }}
              />
              Driver operations
            </div>
            <h1 className="text-3xl md:text-4xl font-semibold text-black">Driver Dashboard</h1>
            <p className="text-gray-700 mt-2">
              Offers first, then accepted trips become current trips.
            </p>
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
          <div
            className="border rounded-2xl p-4 text-sm text-black"
            style={{ background: "var(--moovu-primary-soft)" }}
          >
            {info}
          </div>
        )}

        {gpsInfo && (
          <div className="border rounded-2xl p-4 text-sm bg-white text-black shadow-sm">
            {gpsInfo}
          </div>
        )}

        {!driver ? (
          <div className="border rounded-2xl p-5 bg-white shadow-sm text-gray-700">
            Driver record not found.
          </div>
        ) : (
          <>
            <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h2 className="text-xl font-semibold text-black">Profile</h2>

                  <div className="text-sm text-gray-700">
                    {driver.first_name ?? "—"} {driver.last_name ?? ""} • {driver.phone ?? "—"}
                  </div>

                  <div className="text-sm text-gray-700">
                    Approval status: <span className="font-medium text-black">{driver.status ?? "—"}</span>
                    {" • "}Verification: <span className="font-medium text-black">{driver.verification_status ?? "—"}</span>
                  </div>

                  <div className="text-sm text-gray-700">
                    Online: <span className="font-medium text-black">{driver.online ? "Yes" : "No"}</span>
                    {" • "}Busy: <span className="font-medium text-black">{driver.busy ? "Yes" : "No"}</span>
                  </div>

                  <div className="text-sm text-gray-700">
                    Subscription: <span className="font-medium text-black">{driver.subscription_status ?? "—"}</span>
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
                      className="border rounded-xl px-4 py-2 bg-white text-black"
                      disabled={busy}
                      onClick={() => setOnlineServer(false)}
                    >
                      Go Offline
                    </button>

                    <button
                      className="border rounded-xl px-4 py-2 bg-white text-black"
                      onClick={() => router.push("/driver/complete-profile")}
                    >
                      {driver.profile_completed ? "Edit Application" : "Complete Application"}
                    </button>

                    <button
                      className="border rounded-xl px-4 py-2 bg-white text-black"
                      onClick={() => router.push("/driver/earnings")}
                    >
                      View Earnings
                    </button>

                    <button
                      className="border rounded-xl px-4 py-2 bg-white text-black"
                      onClick={() => router.push("/driver/history")}
                    >
                      Trip History
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <h2 className="text-xl font-semibold text-black">Location</h2>

                  <input
                    className="rounded-xl p-3 w-full border"
                    placeholder="Update location manually"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                  />

                  <div className="flex flex-wrap gap-2">
                    <button
                      className="border rounded-xl px-4 py-2 bg-white text-black"
                      disabled={busy}
                      onClick={saveLocationFromName}
                    >
                      Save Manual Location
                    </button>

                    <button
                      className="rounded-xl px-4 py-2 text-white"
                      style={{ background: "var(--moovu-primary)" }}
                      disabled={busy}
                      onClick={() => captureCurrentLocationAndSave(true)}
                    >
                      Save Current GPS
                    </button>
                  </div>

                  <div className="text-xs text-gray-600">
                    Current coords:{" "}
                    {driver.lat != null && driver.lng != null
                      ? `${driver.lat}, ${driver.lng}`
                      : "—"}
                  </div>
                </div>
              </div>
            </section>

            <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
              <h2 className="text-xl font-semibold text-black">Current Offer</h2>

              {!offer ? (
                <p className="text-gray-700">No pending trip offer.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div
                      className="border rounded-2xl p-4"
                      style={{ background: "var(--moovu-primary-soft)" }}
                    >
                      <div className="text-sm text-gray-600">Pickup</div>
                      <div className="font-medium mt-1 text-black">{offer.pickup_address ?? "—"}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Dropoff</div>
                      <div className="font-medium mt-1 text-black">{offer.dropoff_address ?? "—"}</div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-4 gap-4">
                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Offer status</div>
                      <div className="font-semibold mt-1 text-black">{offer.offer_status}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Fare</div>
                      <div className="font-semibold mt-1 text-black">R{offer.fare_amount ?? "—"}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Payment</div>
                      <div className="font-semibold mt-1 text-black">{offer.payment_method ?? "—"}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Time left</div>
                      <div className="font-semibold mt-1 text-black">
                        {secondsLeft != null ? `${secondsLeft}s` : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      className="rounded-xl px-4 py-2 text-white"
                      style={{ background: "var(--moovu-primary)" }}
                      disabled={busy || secondsLeft === 0}
                      onClick={() => respondToOffer("accept")}
                    >
                      Accept Trip
                    </button>

                    <button
                      className="border rounded-xl px-4 py-2 bg-white text-black"
                      disabled={busy || secondsLeft === 0}
                      onClick={() => respondToOffer("reject")}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="border rounded-[2rem] p-5 bg-white shadow-sm space-y-3">
              <h2 className="text-xl font-semibold text-black">Driver Map</h2>

              {mapError ? (
                <div
                  className="border rounded-2xl p-4 text-sm text-black"
                  style={{ background: "var(--moovu-primary-soft)" }}
                >
                  {mapError}
                </div>
              ) : (
                <div
                  ref={mapRef}
                  className="w-full h-[55vh] rounded-[1.5rem] border bg-gray-100"
                />
              )}
            </section>

            <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
              <h2 className="text-xl font-semibold text-black">Current Trip</h2>

              {!currentTrip ? (
                <p className="text-gray-700">No active trip.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div
                      className="border rounded-2xl p-4"
                      style={{ background: "var(--moovu-primary-soft)" }}
                    >
                      <div className="text-sm text-gray-600">Pickup</div>
                      <div className="font-medium mt-1 text-black">{currentTrip.pickup_address ?? "—"}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Dropoff</div>
                      <div className="font-medium mt-1 text-black">{currentTrip.dropoff_address ?? "—"}</div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Status</div>
                      <div className="font-semibold mt-1 text-black">{currentTrip.status}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Fare</div>
                      <div className="font-semibold mt-1 text-black">R{currentTrip.fare_amount ?? "—"}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Payment</div>
                      <div className="font-semibold mt-1 text-black">{currentTrip.payment_method ?? "—"}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {pickupGoogle && (
                      <a
                        className="border rounded-xl px-4 py-2 bg-white text-black"
                        href={pickupGoogle}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Pickup Google Maps
                      </a>
                    )}

                    {pickupWaze && (
                      <a
                        className="border rounded-xl px-4 py-2 bg-white text-black"
                        href={pickupWaze}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Pickup Waze
                      </a>
                    )}

                    {dropoffGoogle && (
                      <a
                        className="border rounded-xl px-4 py-2 bg-white text-black"
                        href={dropoffGoogle}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Dropoff Google Maps
                      </a>
                    )}

                    {dropoffWaze && (
                      <a
                        className="border rounded-xl px-4 py-2 bg-white text-black"
                        href={dropoffWaze}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Dropoff Waze
                      </a>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {currentTrip.status === "assigned" && (
                      <button
                        className="rounded-xl px-4 py-2 text-white"
                        style={{ background: "var(--moovu-primary)" }}
                        disabled={busy}
                        onClick={() => arriveTrip(currentTrip.id)}
                      >
                        Arrived
                      </button>
                    )}

                    {currentTrip.status === "arrived" && (
                      <div className="space-y-3 w-full">
                        {!showStartOtp ? (
                          <button
                            onClick={() => setShowStartOtp(true)}
                            disabled={busy}
                            className="border rounded-xl px-4 py-2 bg-white text-black"
                          >
                            Enter Start OTP
                          </button>
                        ) : (
                          <div className="space-y-2 max-w-md">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={4}
                              value={startOtp}
                              onChange={(e) => setStartOtp(e.target.value)}
                              placeholder="Enter passenger start OTP"
                              className="w-full rounded-xl border px-4 py-3"
                            />

                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  await startTrip(currentTrip.id, startOtp);
                                  setStartOtp("");
                                  setShowStartOtp(false);
                                }}
                                disabled={busy || startOtp.trim().length < 4}
                                className="rounded-xl px-4 py-3 text-white"
                                style={{ background: "var(--moovu-primary)" }}
                              >
                                Verify & Start
                              </button>

                              <button
                                onClick={() => {
                                  setStartOtp("");
                                  setShowStartOtp(false);
                                }}
                                disabled={busy}
                                className="rounded-xl border px-4 py-3 bg-white text-black"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {currentTrip.status === "ongoing" && (
                      <div className="space-y-3 w-full">
                        {!showEndOtp ? (
                          <button
                            onClick={() => setShowEndOtp(true)}
                            disabled={busy}
                            className="rounded-xl px-4 py-2 text-white"
                            style={{ background: "var(--moovu-primary)" }}
                          >
                            Enter End OTP
                          </button>
                        ) : (
                          <div className="space-y-2 max-w-md">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={4}
                              value={endOtp}
                              onChange={(e) => setEndOtp(e.target.value)}
                              placeholder="Enter passenger end OTP"
                              className="w-full rounded-xl border px-4 py-3"
                            />

                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  await completeTrip(currentTrip.id, endOtp);
                                  setEndOtp("");
                                  setShowEndOtp(false);
                                }}
                                disabled={busy || endOtp.trim().length < 4}
                                className="rounded-xl px-4 py-3 text-white"
                                style={{ background: "var(--moovu-primary)" }}
                              >
                                Verify & Complete
                              </button>

                              <button
                                onClick={() => {
                                  setEndOtp("");
                                  setShowEndOtp(false);
                                }}
                                disabled={busy}
                                className="rounded-xl border px-4 py-3 bg-white text-black"
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
          </>
        )}
      </div>
    </main>
  );
}