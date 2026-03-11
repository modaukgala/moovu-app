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
  profile_completed?: boolean | null;
  verification_status?: string | null;
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

function waLinkZA(phone: string, message: string) {
  const cleaned = phone.replace(/\D/g, "");
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

const ADMIN_WHATSAPP = "27738812739";

export default function DriverHomePage() {
  const router = useRouter();

  const [driver, setDriver] = useState<Driver | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [currentTrip, setCurrentTrip] = useState<ActiveTrip | null>(null);

  const [locationName, setLocationName] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [gpsInfo, setGpsInfo] = useState<string | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [showSubscriptionDetails, setShowSubscriptionDetails] = useState(false);

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
    if (!session) return null;

    const { data: mapping, error: mErr } = await supabaseClient
      .from("driver_accounts")
      .select("driver_id")
      .single();

    if (mErr || !mapping?.driver_id) {
      setInfo("Your account is not linked yet. Please wait for admin approval and linking.");
      setDriver(null);
      return null;
    }

    const driverId = mapping.driver_id;

    const { data: d, error: dErr } = await supabaseClient
      .from("drivers")
      .select(
        "id,first_name,last_name,phone,email,status,online,busy,subscription_status,subscription_expires_at,subscription_plan,lat,lng,last_seen,profile_completed,verification_status"
      )
      .eq("id", driverId)
      .single();

    if (dErr || !d) {
      setInfo("Driver record not found for your account mapping.");
      setDriver(null);
      return null;
    }

    setDriver(d as any);
    return d as Driver;
  }

  async function ensureProfileCompleted() {
    setCheckingProfile(true);

    const loadedDriver = await loadDriverFromMapping();
    if (!loadedDriver) {
      setCheckingProfile(false);
      return false;
    }

    if (!loadedDriver.profile_completed) {
      router.replace("/driver/complete-profile");
      return false;
    }

    setCheckingProfile(false);
    return true;
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
      headers: { "Content-Type": "application/json" },
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
        (
          result: google.maps.DirectionsResult | null,
          status: google.maps.DirectionsStatus
        ) => {
          if (status === "OK" && result) {
            directionsRenderer.setDirections(result);
          }
        }
      );
    }
  }

  useEffect(() => {
    (async () => {
      const ok = await ensureProfileCompleted();
      if (!ok) return;

      await pollOffers();
      await loadCurrentTrip();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;

    if (!driver?.online || checkingProfile) return;

    pollTimerRef.current = setInterval(() => {
      pollOffers();
      loadCurrentTrip();
    }, 2000);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [driver?.online, checkingProfile]);

  useEffect(() => {
    if (gpsTimerRef.current) clearInterval(gpsTimerRef.current);
    gpsTimerRef.current = null;

    if (!driver?.online || checkingProfile) {
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
  }, [driver?.online, checkingProfile]);

  useEffect(() => {
    let cancelled = false;

    function initMap() {
      if (!mapRef.current || !window.google?.maps) return;

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

    const existingScript = document.getElementById("google-maps-script") as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener("load", initMap);
      return () => {
        cancelled = true;
        existingScript.removeEventListener("load", initMap);
      };
    }

    const script = document.createElement("script");
    script.id = "google-maps-script";
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
    if (!mapReady || checkingProfile) return;
    renderDriverMap();
  }, [mapReady, driver, currentTrip, checkingProfile]);

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

  const subscriptionExpiryText = useMemo(() => {
    if (!driver?.subscription_expires_at) return "No expiry date available";
    return new Date(driver.subscription_expires_at).toLocaleString();
  }, [driver?.subscription_expires_at]);

  const subscriptionWarning = useMemo(() => {
    if (!driver?.subscription_expires_at) {
      return {
        type: "warning",
        text: "Your subscription expiry date is not set. Please contact admin if this looks incorrect.",
      };
    }

    const expiry = new Date(driver.subscription_expires_at).getTime();
    const now = Date.now();
    const diffMs = expiry - now;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffMs <= 0) {
      return {
        type: "expired",
        text: "Your subscription has expired. Renew it as soon as possible to continue receiving trips.",
      };
    }

    if (diffDays <= 3) {
      return {
        type: "soon",
        text: `Your subscription is expiring soon. It ends on ${new Date(
          driver.subscription_expires_at
        ).toLocaleString()}.`,
      };
    }

    return null;
  }, [driver?.subscription_expires_at]);

  const renewDayHref = useMemo(() => {
    const name = `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver";
    return waLinkZA(
      ADMIN_WHATSAPP,
      `Hi Admin, this is ${name}. I want to renew my MOOVU subscription for 1 day at R45. Please assist me with payment details so my subscription can be renewed.`
    );
  }, [driver?.first_name, driver?.last_name]);

  const renewWeekHref = useMemo(() => {
    const name = `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver";
    return waLinkZA(
      ADMIN_WHATSAPP,
      `Hi Admin, this is ${name}. I want to renew my MOOVU subscription for 1 week at R90. Please assist me with payment details so my subscription can be renewed.`
    );
  }, [driver?.first_name, driver?.last_name]);

  const renewMonthHref = useMemo(() => {
    const name = `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver";
    return waLinkZA(
      ADMIN_WHATSAPP,
      `Hi Admin, this is ${name}. I want to renew my MOOVU subscription for 1 month at R200. Please assist me with payment details so my subscription can be renewed.`
    );
  }, [driver?.first_name, driver?.last_name]);

  const pickupGoogle = googleMapsLink(currentTrip?.pickup_lat, currentTrip?.pickup_lng);
  const pickupWaze = wazeLink(currentTrip?.pickup_lat, currentTrip?.pickup_lng);
  const dropoffGoogle = googleMapsLink(currentTrip?.dropoff_lat, currentTrip?.dropoff_lng);
  const dropoffWaze = wazeLink(currentTrip?.dropoff_lat, currentTrip?.dropoff_lng);

  if (checkingProfile) {
    return (
      <main className="min-h-screen px-6 py-10 text-black">
        <div className="max-w-4xl mx-auto border rounded-[2rem] p-6 bg-white shadow-sm">
          Checking driver profile...
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
            <p className="text-gray-700 mt-2">Trip controls, navigation and live map in one place.</p>
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
          <div className="border rounded-2xl p-5 bg-white shadow-sm text-gray-700">Loading driver...</div>
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
                    {" • "}
                    Subscription: <span className="font-medium text-black">{subscriptionLabel}</span>
                  </div>

                  <div className="text-sm text-gray-700">
                    Verification: <span className="font-medium text-black">{driver.verification_status ?? "—"}</span>
                    {" • "}
                    Profile completed:{" "}
                    <span className="font-medium text-black">{driver.profile_completed ? "Yes" : "No"}</span>
                  </div>

                  <div className="text-sm text-gray-700">
                    Online: <span className="font-medium text-black">{driver.online ? "Yes" : "No"}</span>
                    {" • "}
                    Busy: <span className="font-medium text-black">{driver.busy ? "Yes" : "No"}</span>
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
                      disabled={busy}
                      onClick={() => {
                        pollOffers();
                        loadCurrentTrip();
                        heartbeatNow();
                      }}
                    >
                      Refresh
                    </button>

                    <button
                      className="border rounded-xl px-4 py-2 bg-white text-black"
                      onClick={() => router.push("/driver/complete-profile")}
                    >
                      Edit Profile
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <h2 className="text-xl font-semibold text-black">Location</h2>

                  <input
                    className="rounded-xl p-3 w-full"
                    placeholder="Update location manually"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                  />

                  <button
                    className="border rounded-xl px-4 py-2 bg-white text-black"
                    disabled={busy}
                    onClick={saveLocationFromName}
                  >
                    Save Location Manually
                  </button>

                  <div className="text-xs text-gray-600">
                    Current coords: {driver.lat != null && driver.lng != null ? `${driver.lat}, ${driver.lng}` : "—"}
                  </div>
                </div>
              </div>
            </section>

            {subscriptionWarning && (
              <section
                className="border rounded-[2rem] p-5 shadow-sm"
                style={{
                  background:
                    subscriptionWarning.type === "expired"
                      ? "#fee2e2"
                      : "#fff7e6",
                  borderColor:
                    subscriptionWarning.type === "expired"
                      ? "#fca5a5"
                      : "#fcd34d",
                }}
              >
                <h2 className="text-lg font-semibold text-black">
                  {subscriptionWarning.type === "expired"
                    ? "Subscription Expired"
                    : "Subscription Warning"}
                </h2>
                <p className="text-sm text-black mt-2">{subscriptionWarning.text}</p>
              </section>
            )}

            <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-black">Subscription</h2>
                  <p className="text-sm text-gray-700 mt-1">
                    View your subscription end date and choose a renewal option.
                  </p>
                </div>

                <button
                  className="rounded-xl px-4 py-2 text-white"
                  style={{ background: "var(--moovu-primary)" }}
                  onClick={() => setShowSubscriptionDetails((v) => !v)}
                >
                  {showSubscriptionDetails ? "Hide Subscription Details" : "Show Subscription Details"}
                </button>
              </div>

              {showSubscriptionDetails && (
                <div className="space-y-4">
                  <div className="grid md:grid-cols-3 gap-4">
                    <div
                      className="border rounded-2xl p-4"
                      style={{ background: "var(--moovu-primary-soft)" }}
                    >
                      <div className="text-sm text-gray-600">Current status</div>
                      <div className="font-semibold mt-1 text-black">{driver.subscription_status ?? "—"}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Current plan</div>
                      <div className="font-semibold mt-1 text-black">{driver.subscription_plan ?? "—"}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Subscription ends</div>
                      <div className="font-semibold mt-1 text-black">{subscriptionExpiryText}</div>
                    </div>
                  </div>

                  <div className="border rounded-2xl p-4 bg-white">
                    <div className="font-semibold text-black">Renewal Options</div>
                    <p className="text-sm text-gray-700 mt-1">
                      To renew, choose an option below and contact admin on WhatsApp to arrange payment.
                    </p>

                    <div className="grid md:grid-cols-3 gap-4 mt-4">
                      <div className="border rounded-2xl p-4">
                        <div className="text-sm text-gray-600">Daily Subscription</div>
                        <div className="text-2xl font-semibold mt-1 text-black">R45</div>
                        <div className="text-sm text-gray-700 mt-2">Valid for 1 day</div>
                        <a
                          href={renewDayHref}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block mt-4 rounded-xl px-4 py-2 text-white"
                          style={{ background: "var(--moovu-primary)" }}
                        >
                          Renew Daily
                        </a>
                      </div>

                      <div className="border rounded-2xl p-4">
                        <div className="text-sm text-gray-600">Weekly Subscription</div>
                        <div className="text-2xl font-semibold mt-1 text-black">R90</div>
                        <div className="text-sm text-gray-700 mt-2">Valid for 1 week</div>
                        <a
                          href={renewWeekHref}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block mt-4 rounded-xl px-4 py-2 text-white"
                          style={{ background: "var(--moovu-primary)" }}
                        >
                          Renew Weekly
                        </a>
                      </div>

                      <div className="border rounded-2xl p-4">
                        <div className="text-sm text-gray-600">Monthly Subscription</div>
                        <div className="text-2xl font-semibold mt-1 text-black">R200</div>
                        <div className="text-sm text-gray-700 mt-2">Valid for 1 month</div>
                        <a
                          href={renewMonthHref}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block mt-4 rounded-xl px-4 py-2 text-white"
                          style={{ background: "var(--moovu-primary)" }}
                        >
                          Renew Monthly
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="border rounded-[2rem] p-5 bg-white shadow-sm">
              <h2 className="text-xl font-semibold text-black mb-4">Driver Map</h2>
              <div ref={mapRef} className="w-full h-[55vh] rounded-[1.5rem]" />
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
                      <div className="font-medium mt-1 text-black">{currentTrip.pickup_address}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Dropoff</div>
                      <div className="font-medium mt-1 text-black">{currentTrip.dropoff_address}</div>
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
                      <a className="border rounded-xl px-4 py-2 bg-white text-black" href={pickupGoogle} target="_blank" rel="noreferrer">
                        Pickup Google Maps
                      </a>
                    )}

                    {pickupWaze && (
                      <a className="border rounded-xl px-4 py-2 bg-white text-black" href={pickupWaze} target="_blank" rel="noreferrer">
                        Pickup Waze
                      </a>
                    )}

                    {dropoffGoogle && (
                      <a className="border rounded-xl px-4 py-2 bg-white text-black" href={dropoffGoogle} target="_blank" rel="noreferrer">
                        Dropoff Google Maps
                      </a>
                    )}

                    {dropoffWaze && (
                      <a className="border rounded-xl px-4 py-2 bg-white text-black" href={dropoffWaze} target="_blank" rel="noreferrer">
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
                          className="border rounded-xl px-4 py-2 bg-white text-black"
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
                          className="border rounded-xl px-4 py-2 bg-white text-black"
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

            <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
              <h2 className="text-xl font-semibold text-black">Current Offer</h2>

              {!topOffer ? (
                <p className="text-gray-700">No pending offers.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div
                      className="border rounded-2xl p-4"
                      style={{ background: "var(--moovu-primary-soft)" }}
                    >
                      <div className="text-sm text-gray-600">Pickup</div>
                      <div className="font-medium mt-1 text-black">{topOffer.pickup_address}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Dropoff</div>
                      <div className="font-medium mt-1 text-black">{topOffer.dropoff_address}</div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Offer status</div>
                      <div className="font-semibold mt-1 text-black">{topOffer.offer_status}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Fare</div>
                      <div className="font-semibold mt-1 text-black">R{topOffer.fare_amount ?? "—"}</div>
                    </div>

                    <div className="border rounded-2xl p-4 bg-white">
                      <div className="text-sm text-gray-600">Time left</div>
                      <div className="font-semibold mt-1 text-black">{secondsLeft != null ? `${secondsLeft}s` : "—"}</div>
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
                      className="border rounded-xl px-4 py-2 bg-white text-black"
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