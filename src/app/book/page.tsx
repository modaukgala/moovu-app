"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type CustomerMe = {
  ok: boolean;
  customer?: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
  };
  error?: string;
};

type Prediction = {
  description: string;
  place_id: string;
};

function wholeRand(value: number | null | undefined) {
  return value == null ? null : Math.round(Number(value));
}

export default function RiderBookingPage() {
  const router = useRouter();

  const [customer, setCustomer] = useState<CustomerMe["customer"] | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");

  const [pickupPlaceId, setPickupPlaceId] = useState("");
  const [dropoffPlaceId, setDropoffPlaceId] = useState("");

  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);
  const [dropoffLat, setDropoffLat] = useState<number | null>(null);
  const [dropoffLng, setDropoffLng] = useState<number | null>(null);

  const [pickupPredictions, setPickupPredictions] = useState<Prediction[]>([]);
  const [dropoffPredictions, setDropoffPredictions] = useState<Prediction[]>([]);

  const [pickupLoading, setPickupLoading] = useState(false);
  const [dropoffLoading, setDropoffLoading] = useState(false);

  const [showPickupDropdown, setShowPickupDropdown] = useState(false);
  const [showDropoffDropdown, setShowDropoffDropdown] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [rideType, setRideType] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [fare, setFare] = useState<number | null>(null);

  const pickupBoxRef = useRef<HTMLDivElement | null>(null);
  const dropoffBoxRef = useRef<HTMLDivElement | null>(null);
  const pickupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canCalculate = useMemo(() => {
    return (
      !!pickupAddress.trim() &&
      !!dropoffAddress.trim() &&
      pickupLat != null &&
      pickupLng != null &&
      dropoffLat != null &&
      dropoffLng != null
    );
  }, [
    pickupAddress,
    dropoffAddress,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
  ]);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token || "";
  }

  async function loadCustomer() {
    setAuthLoading(true);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      router.replace("/customer/auth?next=/book");
      return;
    }

    const res = await fetch("/api/customer/me", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const json = (await res.json()) as CustomerMe;

    if (!json?.ok || !json.customer) {
      router.replace("/customer/auth?next=/book");
      return;
    }

    setCustomer(json.customer);
    setAuthLoading(false);
  }

  async function logout() {
    await supabaseClient.auth.signOut();
    router.push("/customer/auth");
  }

  function resetRouteState() {
    setDistanceKm(null);
    setDurationMin(null);
    setFare(null);
  }

  function clearPickupSelection() {
    setPickupPlaceId("");
    setPickupLat(null);
    setPickupLng(null);
    resetRouteState();
  }

  function clearDropoffSelection() {
    setDropoffPlaceId("");
    setDropoffLat(null);
    setDropoffLng(null);
    resetRouteState();
  }

  async function reverseGeocode(lat: number, lng: number) {
    const res = await fetch("/api/maps/reverse-geocode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lat, lng }),
    });

    return res.json();
  }

  async function useCurrentLocation() {
    setMsg(null);

    if (!navigator.geolocation) {
      setMsg("This device/browser does not support location.");
      return;
    }

    setBusy(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        setPickupLat(lat);
        setPickupLng(lng);
        setPickupPlaceId("");
        setPickupPredictions([]);
        setShowPickupDropdown(false);
        resetRouteState();

        const json = await reverseGeocode(lat, lng);

        if (json.ok) {
          setPickupAddress(json.address ?? "Current location");
          setMsg("Current pickup location detected ✅");
        } else {
          setPickupAddress("Current location");
          setMsg("Location detected, but address name could not be resolved.");
        }

        setBusy(false);
      },
      (err) => {
        setBusy(false);
        setMsg(`Could not detect current location: ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      }
    );
  }

  async function fetchPredictions(kind: "pickup" | "dropoff", input: string) {
    if (input.trim().length < 3) {
      if (kind === "pickup") {
        setPickupPredictions([]);
        setShowPickupDropdown(false);
        setPickupLoading(false);
      } else {
        setDropoffPredictions([]);
        setShowDropoffDropdown(false);
        setDropoffLoading(false);
      }
      return;
    }

    if (kind === "pickup") setPickupLoading(true);
    if (kind === "dropoff") setDropoffLoading(true);

    try {
      const res = await fetch("/api/maps/autocomplete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        if (kind === "pickup") {
          setPickupPredictions([]);
          setShowPickupDropdown(false);
        } else {
          setDropoffPredictions([]);
          setShowDropoffDropdown(false);
        }
        return;
      }

      const predictions = (json.predictions ?? []) as Prediction[];

      if (kind === "pickup") {
        setPickupPredictions(predictions);
        setShowPickupDropdown(predictions.length > 0);
      } else {
        setDropoffPredictions(predictions);
        setShowDropoffDropdown(predictions.length > 0);
      }
    } finally {
      if (kind === "pickup") setPickupLoading(false);
      if (kind === "dropoff") setDropoffLoading(false);
    }
  }

  function onPickupInputChange(value: string) {
    setPickupAddress(value);
    clearPickupSelection();

    if (pickupTimerRef.current) clearTimeout(pickupTimerRef.current);
    pickupTimerRef.current = setTimeout(() => {
      fetchPredictions("pickup", value);
    }, 250);
  }

  function onDropoffInputChange(value: string) {
    setDropoffAddress(value);
    clearDropoffSelection();

    if (dropoffTimerRef.current) clearTimeout(dropoffTimerRef.current);
    dropoffTimerRef.current = setTimeout(() => {
      fetchPredictions("dropoff", value);
    }, 250);
  }

  async function choosePlace(kind: "pickup" | "dropoff", placeId: string, description: string) {
    setMsg(null);

    const res = await fetch("/api/maps/place-details", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ place_id: placeId }),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load place details.");
      return;
    }

    if (kind === "pickup") {
      setPickupAddress(json.formatted_address || description);
      setPickupPlaceId(json.place_id || placeId);
      setPickupLat(typeof json.lat === "number" ? json.lat : null);
      setPickupLng(typeof json.lng === "number" ? json.lng : null);
      setPickupPredictions([]);
      setShowPickupDropdown(false);
    } else {
      setDropoffAddress(json.formatted_address || description);
      setDropoffPlaceId(json.place_id || placeId);
      setDropoffLat(typeof json.lat === "number" ? json.lat : null);
      setDropoffLng(typeof json.lng === "number" ? json.lng : null);
      setDropoffPredictions([]);
      setShowDropoffDropdown(false);
    }

    resetRouteState();
    setMsg(kind === "pickup" ? "Pickup selected ✅" : "Destination selected ✅");
  }

  async function calculateTrip() {
    setMsg(null);

    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      setMsg("Pickup and destination are required.");
      return;
    }

    if (
      pickupLat == null ||
      pickupLng == null ||
      dropoffLat == null ||
      dropoffLng == null
    ) {
      setMsg("Please select valid pickup and destination addresses.");
      return;
    }

    const payload =
      pickupPlaceId && dropoffPlaceId
        ? {
            origin_place_id: pickupPlaceId,
            destination_place_id: dropoffPlaceId,
          }
        : {
            origin_lat: pickupLat,
            origin_lng: pickupLng,
            destination_lat: dropoffLat,
            destination_lng: dropoffLng,
          };

    const res = await fetch("/api/maps/distance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Could not calculate trip distance.");
      return;
    }

    const km = Number(json.distanceKm ?? 0);
    const mins = Number(json.durationMin ?? 0);
    const estimatedFare = Math.max(40, 25 + km * 7 + mins * 1.2);

    setDistanceKm(Number(km.toFixed(2)));
    setDurationMin(Math.ceil(mins));
    setFare(Math.round(estimatedFare));
    setMsg("Fare calculated ✅");
  }

  async function submitBooking() {
    setMsg(null);

    if (!customer) {
      setMsg("Your customer account could not be loaded.");
      return;
    }

    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      setMsg("Pickup and destination are required.");
      return;
    }

    if (
      pickupLat == null ||
      pickupLng == null ||
      dropoffLat == null ||
      dropoffLng == null
    ) {
      setMsg("Please select valid pickup and destination addresses.");
      return;
    }

    if (distanceKm == null || durationMin == null) {
      setMsg("Calculate fare first.");
      return;
    }

    if (rideType === "scheduled" && !scheduledFor) {
      setMsg("Please choose the scheduled pickup date and time.");
      return;
    }

    setBusy(true);

    try {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        router.replace("/customer/auth?next=/book");
        return;
      }

      const res = await fetch("/api/customer/book-trip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          pickupAddress,
          dropoffAddress,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          paymentMethod,
          distanceKm,
          durationMin,
          rideType,
          scheduledFor: rideType === "scheduled" ? scheduledFor : null,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setMsg(json?.error || "Could not create trip.");
        setBusy(false);
        return;
      }

      const bookedFareRaw =
        json?.trip?.fare_amount ??
        json?.fareBreakdown?.totalFare ??
        fare;

      const bookedFare = wholeRand(bookedFareRaw);
      setFare(bookedFare);

      const tripId = json?.tripId ?? json?.trip?.id;
      if (tripId) {
        window.location.href = `/ride/${tripId}`;
        return;
      }

      setMsg(
        rideType === "scheduled"
          ? `Ride scheduled successfully ✅ Estimated fare: R${bookedFare ?? 0}`
          : `Trip booked successfully ✅ Fare: R${bookedFare ?? 0}`
      );
    } catch (e: any) {
      setMsg(e?.message || "Could not create trip.");
    }

    setBusy(false);
  }

  useEffect(() => {
    loadCustomer();

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;

      if (pickupBoxRef.current && !pickupBoxRef.current.contains(target)) {
        setShowPickupDropdown(false);
      }

      if (dropoffBoxRef.current && !dropoffBoxRef.current.contains(target)) {
        setShowDropoffDropdown(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (pickupTimerRef.current) clearTimeout(pickupTimerRef.current);
      if (dropoffTimerRef.current) clearTimeout(dropoffTimerRef.current);
    };
  }, []);

  if (authLoading) {
    return <main className="p-6 text-black">Loading your booking account...</main>;
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">MOOVU Rider</div>
          <h1 className="text-3xl font-semibold mt-1">Book a Ride</h1>
          <p className="text-gray-700 mt-2">
            Ride now or schedule for later.
          </p>
        </div>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Customer Details</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-xl p-3 bg-gray-50">
              <div className="text-sm text-gray-500">Full name</div>
              <div className="font-medium">
                {customer?.first_name} {customer?.last_name}
              </div>
            </div>

            <div className="border rounded-xl p-3 bg-gray-50">
              <div className="text-sm text-gray-500">Phone number</div>
              <div className="font-medium">{customer?.phone}</div>
            </div>
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Ride Type</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <button
              type="button"
              className="border rounded-xl p-4 text-left"
              style={rideType === "now" ? { background: "var(--moovu-primary-soft)" } : undefined}
              onClick={() => setRideType("now")}
            >
              <div className="font-semibold">Ride Now</div>
              <div className="text-sm text-gray-600 mt-1">Request a driver immediately.</div>
            </button>

            <button
              type="button"
              className="border rounded-xl p-4 text-left"
              style={rideType === "scheduled" ? { background: "var(--moovu-primary-soft)" } : undefined}
              onClick={() => setRideType("scheduled")}
            >
              <div className="font-semibold">Schedule Ride</div>
              <div className="text-sm text-gray-600 mt-1">Book your ride for later.</div>
            </button>
          </div>

          {rideType === "scheduled" && (
            <input
              type="datetime-local"
              className="border rounded-xl p-3 w-full"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          )}
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Trip Details</h2>

          <div className="space-y-3">
            <button
              className="rounded-xl px-4 py-2 text-white"
              style={{ background: "var(--moovu-primary)" }}
              onClick={useCurrentLocation}
              disabled={busy}
            >
              Use Current Pickup Location
            </button>

            <div className="relative" ref={pickupBoxRef}>
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Pickup address"
                value={pickupAddress}
                onChange={(e) => onPickupInputChange(e.target.value)}
                onFocus={() => {
                  if (pickupPredictions.length > 0) setShowPickupDropdown(true);
                }}
              />

              {pickupLoading && (
                <div className="text-xs text-gray-500 mt-1">Searching pickup locations...</div>
              )}

              {showPickupDropdown && pickupPredictions.length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-xl border bg-white shadow-lg overflow-hidden">
                  {pickupPredictions.map((item) => (
                    <button
                      key={item.place_id}
                      type="button"
                      className="block w-full text-left px-4 py-3 hover:bg-gray-50 border-b last:border-b-0"
                      onClick={() => choosePlace("pickup", item.place_id, item.description)}
                    >
                      {item.description}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative" ref={dropoffBoxRef}>
              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Destination address"
                value={dropoffAddress}
                onChange={(e) => onDropoffInputChange(e.target.value)}
                onFocus={() => {
                  if (dropoffPredictions.length > 0) setShowDropoffDropdown(true);
                }}
              />

              {dropoffLoading && (
                <div className="text-xs text-gray-500 mt-1">Searching destinations...</div>
              )}

              {showDropoffDropdown && dropoffPredictions.length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-xl border bg-white shadow-lg overflow-hidden">
                  {dropoffPredictions.map((item) => (
                    <button
                      key={item.place_id}
                      type="button"
                      className="block w-full text-left px-4 py-3 hover:bg-gray-50 border-b last:border-b-0"
                      onClick={() => choosePlace("dropoff", item.place_id, item.description)}
                    >
                      {item.description}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <select
              className="border rounded-xl p-3 w-full bg-transparent"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="cash">Cash</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="border rounded-xl px-4 py-2"
              onClick={calculateTrip}
              disabled={busy}
            >
              Calculate Fare
            </button>

            <button
              className="rounded-xl px-4 py-2 text-white"
              style={{ background: "var(--moovu-primary)" }}
              onClick={submitBooking}
              disabled={busy}
            >
              {busy
                ? rideType === "scheduled"
                  ? "Scheduling..."
                  : "Booking..."
                : rideType === "scheduled"
                ? "Schedule Ride"
                : "Book Ride"}
            </button>
          </div>

          <div className="grid md:grid-cols-3 gap-4 pt-2">
            <div className="border rounded-2xl p-4">
              <div className="text-sm text-gray-600">Distance</div>
              <div className="font-semibold mt-1">
                {distanceKm != null ? `${distanceKm} km` : "—"}
              </div>
            </div>

            <div className="border rounded-2xl p-4">
              <div className="text-sm text-gray-600">Duration</div>
              <div className="font-semibold mt-1">
                {durationMin != null ? `${durationMin} min` : "—"}
              </div>
            </div>

            <div className="border rounded-2xl p-4">
              <div className="text-sm text-gray-600">Estimated Fare</div>
              <div className="font-semibold mt-1">
                {fare != null ? `R${fare}` : "—"}
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-500">
            Pricing model: base fare R25 + R7/km + R1.20/min, minimum fare R40.
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Account</h2>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/ride/history"
              className="border rounded-xl px-4 py-3"
            >
              My Trip History
            </Link>

            <button
              className="border rounded-xl px-4 py-3"
              onClick={logout}
            >
              Logout
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}