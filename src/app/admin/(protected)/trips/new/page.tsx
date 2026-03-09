"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import { calculateKasiFare } from "@/lib/pricing/kasiPricing";

type Driver = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  status: string;
};

type Prediction = {
  description: string;
  place_id: string;
};

function useDebounced<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function NewTripPage() {
  const router = useRouter();

  const [autoAssignOnCreate, setAutoAssignOnCreate] = useState(true);
  const [assignInfo, setAssignInfo] = useState<string | null>(null);

  // Rider + trip fields
  const [riderName, setRiderName] = useState("");
  const [riderPhone, setRiderPhone] = useState("");

  // Pickup/Dropoff display text + place_id (IMPORTANT)
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [pickupPlaceId, setPickupPlaceId] = useState<string | null>(null);
  const [dropoffPlaceId, setDropoffPlaceId] = useState<string | null>(null);

  // Pickup/Dropoff coordinates (NEW)
  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);
  const [dropoffLat, setDropoffLat] = useState<number | null>(null);
  const [dropoffLng, setDropoffLng] = useState<number | null>(null);

  // Autocomplete lists
  const [pickupSuggestions, setPickupSuggestions] = useState<Prediction[]>([]);
  const [dropoffSuggestions, setDropoffSuggestions] = useState<Prediction[]>([]);
  const [pickupOpen, setPickupOpen] = useState(false);
  const [dropoffOpen, setDropoffOpen] = useState(false);

  const debPickup = useDebounced(pickup, 250);
  const debDropoff = useDebounced(dropoff, 250);

  // Pricing inputs
  const [distanceKm, setDistanceKm] = useState("3");
  const [durationMin, setDurationMin] = useState("");
  const [autoFare, setAutoFare] = useState<number | null>(null);

  // Payment + fare override
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "online" | "other">("cash");
  const [fare, setFare] = useState<string>("");

  // Optional assign driver at creation time
  const [driverId, setDriverId] = useState<string>("");
  const [drivers, setDrivers] = useState<Driver[]>([]);

  // UI state
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [calcBusy, setCalcBusy] = useState(false);
  const [calcInfo, setCalcInfo] = useState<string | null>(null);

  const pickupBoxRef = useRef<HTMLDivElement | null>(null);
  const dropoffBoxRef = useRef<HTMLDivElement | null>(null);

  // Load drivers
  useEffect(() => {
    (async () => {
      const { data } = await supabaseClient
        .from("drivers")
        .select("id, first_name, last_name, phone, status")
        .in("status", ["approved", "active"])
        .order("created_at", { ascending: false });

      setDrivers((data as any) ?? []);
    })();
  }, []);

  // Close suggestion popups when clicking outside
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (pickupBoxRef.current && !pickupBoxRef.current.contains(t)) setPickupOpen(false);
      if (dropoffBoxRef.current && !dropoffBoxRef.current.contains(t)) setDropoffOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Fetch pickup suggestions
  useEffect(() => {
    (async () => {
      if (!debPickup || debPickup.trim().length < 3) {
        setPickupSuggestions([]);
        return;
      }

      const res = await fetch("/api/maps/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: debPickup.trim() }),
      });

      const json = await res.json();
      if (json.ok) setPickupSuggestions(json.predictions ?? []);
    })();
  }, [debPickup]);

  // Fetch dropoff suggestions
  useEffect(() => {
    (async () => {
      if (!debDropoff || debDropoff.trim().length < 3) {
        setDropoffSuggestions([]);
        return;
      }

      const res = await fetch("/api/maps/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: debDropoff.trim() }),
      });

      const json = await res.json();
      if (json.ok) setDropoffSuggestions(json.predictions ?? []);
    })();
  }, [debDropoff]);

  // NEW: select pickup and fetch coordinates
  async function selectPickup(p: Prediction) {
    setPickup(p.description);
    setPickupPlaceId(p.place_id);
    setPickupOpen(false);

    // Reset current coords until fetched
    setPickupLat(null);
    setPickupLng(null);

    const res = await fetch("/api/maps/place-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place_id: p.place_id }),
    });
    const json = await res.json();

    if (json.ok) {
      setPickupLat(json.lat);
      setPickupLng(json.lng);
    }
  }

  // NEW: select dropoff and fetch coordinates
  async function selectDropoff(p: Prediction) {
    setDropoff(p.description);
    setDropoffPlaceId(p.place_id);
    setDropoffOpen(false);

    setDropoffLat(null);
    setDropoffLng(null);

    const res = await fetch("/api/maps/place-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place_id: p.place_id }),
    });
    const json = await res.json();

    if (json.ok) {
      setDropoffLat(json.lat);
      setDropoffLng(json.lng);
    }
  }

  async function calculateDistance() {
    setCalcInfo(null);

    if (!pickupPlaceId || !dropoffPlaceId) {
      setCalcInfo("Please select pickup and dropoff from the suggestions list.");
      return;
    }

    setCalcBusy(true);

    const res = await fetch("/api/maps/distance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin_place_id: pickupPlaceId,
        destination_place_id: dropoffPlaceId,
      }),
    });

    const json = await res.json();
    setCalcBusy(false);

    if (!json.ok) {
      setCalcInfo(json.error || "Failed to calculate distance");
      return;
    }

    setDistanceKm(String(json.distanceKm));
    setDurationMin(String(json.durationMin));
    setCalcInfo(`${json.distanceText} • ${json.durationText}`);

    // Auto fare immediately after distance
    const calcFare = calculateKasiFare(Number(json.distanceKm));
    setAutoFare(calcFare);
    setFare(String(calcFare));
  }

  async function createTrip(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!pickup.trim() || !dropoff.trim()) {
      setErr("Pickup and dropoff are required.");
      return;
    }

    if (!pickupPlaceId || !dropoffPlaceId) {
      setErr("Please select pickup and dropoff from the suggestions list.");
      return;
    }

    const km = Number(distanceKm);
    if (!distanceKm || !Number.isFinite(km) || km <= 0) {
      setErr("Distance (km) is required and must be greater than 0.");
      return;
    }

    const finalFare = fare ? Number(fare) : calculateKasiFare(km);
    if (!Number.isFinite(finalFare) || finalFare <= 0) {
      setErr("Fare is invalid. Please auto-calc or enter a valid fare.");
      return;
    }

    setBusy(true);

    const { data: userData } = await supabaseClient.auth.getUser();
    const createdBy = userData.user?.id ?? null;

    const initialStatus = driverId ? "assigned" : "requested";

    const { data: trip, error } = await supabaseClient
      .from("trips")
      .insert({
        created_by: createdBy,
        rider_name: riderName || null,
        rider_phone: riderPhone || null,

        pickup_address: pickup.trim(),
        dropoff_address: dropoff.trim(),

        // NEW: store coordinates
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        dropoff_lat: dropoffLat,
        dropoff_lng: dropoffLng,

        payment_method: paymentMethod,

        fare_amount: finalFare,
        distance_km: km,
        duration_min: durationMin ? Number(durationMin) : null,

        status: initialStatus,
        driver_id: driverId || null,
      })
      .select("*")
      .single();

    if (error || !trip) {
      setBusy(false);
      setErr(error?.message ?? "Failed to create trip");
      return;
    }

    await supabaseClient.from("trip_events").insert({
      trip_id: trip.id,
      event_type: "created",
      message: "Trip created",
      old_status: null,
      new_status: trip.status,
      created_by: createdBy,
    });

    if (driverId) {
      await supabaseClient.from("trip_events").insert({
        trip_id: trip.id,
        event_type: "assignment",
        message: `Assigned driver ${driverId}`,
        old_status: "requested",
        new_status: "assigned",
        created_by: createdBy,
      });
    }

    // Auto assign nearest driver
    await fetch("/api/admin/trips/auto-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tripId: trip.id
      })
    });

    setBusy(false);
    router.push("/admin/trips");
  }

  return (
    <main className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">New Trip</h1>
      <p className="opacity-70 mt-2">Create a ride request manually (dispatcher).</p>

      <form onSubmit={createTrip} className="mt-6 space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <input
            className="border rounded-xl p-3"
            placeholder="Rider name (optional)"
            value={riderName}
            onChange={(e) => setRiderName(e.target.value)}
          />
          <input
            className="border rounded-xl p-3"
            placeholder="Rider phone (optional)"
            value={riderPhone}
            onChange={(e) => setRiderPhone(e.target.value)}
          />
        </div>

        {/* Pickup with autocomplete */}
        <div ref={pickupBoxRef} className="relative">
          <input
            className="border rounded-xl p-3 w-full"
            placeholder="Pickup address / area *"
            value={pickup}
            onChange={(e) => {
              setPickup(e.target.value);
              setPickupPlaceId(null);
              setPickupLat(null);
              setPickupLng(null);
              setPickupOpen(true);
            }}
            onFocus={() => setPickupOpen(true)}
            required
          />

          {pickupOpen && pickupSuggestions.length > 0 && (
            <div className="absolute z-[9999] mt-2 w-full border rounded-2xl bg-white text-black overflow-hidden shadow">
              {pickupSuggestions.slice(0, 6).map((p) => (
                <button
                  key={p.place_id}
                  type="button"
                  className="w-full text-left px-4 py-3 hover:bg-black/5"
                  onClick={() => selectPickup(p)}
                >
                  {p.description}
                </button>
              ))}
            </div>
          )}

          <div className="text-xs opacity-60 mt-1">
            {pickupPlaceId ? "✅ Pickup selected (place_id saved)" : "Select a suggestion so distance can be calculated."}
            {pickupPlaceId && (pickupLat == null || pickupLng == null) ? " • Fetching coords..." : ""}
            {pickupPlaceId && pickupLat != null && pickupLng != null ? " • Coords saved ✅" : ""}
          </div>
        </div>

        {/* Dropoff with autocomplete */}
        <div ref={dropoffBoxRef} className="relative">
          <input
            className="border rounded-xl p-3 w-full"
            placeholder="Dropoff address / area *"
            value={dropoff}
            onChange={(e) => {
              setDropoff(e.target.value);
              setDropoffPlaceId(null);
              setDropoffLat(null);
              setDropoffLng(null);
              setDropoffOpen(true);
            }}
            onFocus={() => setDropoffOpen(true)}
            required
          />

          {dropoffOpen && dropoffSuggestions.length > 0 && (
            <div className="absolute z-[9999] mt-2 w-full border rounded-2xl bg-white text-black overflow-hidden shadow">
              {dropoffSuggestions.slice(0, 6).map((p) => (
                <button
                  key={p.place_id}
                  type="button"
                  className="w-full text-left px-4 py-3 hover:bg-black/5"
                  onClick={() => selectDropoff(p)}
                >
                  {p.description}
                </button>
              ))}
            </div>
          )}

          <div className="text-xs opacity-60 mt-1">
            {dropoffPlaceId ? "✅ Dropoff selected (place_id saved)" : "Select a suggestion so distance can be calculated."}
            {dropoffPlaceId && (dropoffLat == null || dropoffLng == null) ? " • Fetching coords..." : ""}
            {dropoffPlaceId && dropoffLat != null && dropoffLng != null ? " • Coords saved ✅" : ""}
          </div>
        </div>

        {/* Smart Kasi Pricing */}
        <div className="border rounded-2xl p-4">
          <div className="font-semibold">Smart Kasi Pricing</div>
          <div className="text-sm opacity-70 mt-1">
            Base R60 (≤ 3km). Above 3km: +R10 per started km.
          </div>

          <div className="grid md:grid-cols-4 gap-3 mt-4">
            <input
              className="border rounded-xl p-3"
              placeholder="Distance (km) *"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              required
            />

            <input
              className="border rounded-xl p-3"
              placeholder="Duration (min) (optional)"
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
            />

            <button
              type="button"
              className="border rounded-xl p-3"
              disabled={calcBusy}
              onClick={calculateDistance}
            >
              {calcBusy ? "Calculating..." : "Calculate distance"}
            </button>

            <button
              type="button"
              className="border rounded-xl p-3"
              onClick={() => {
                const km = Number(distanceKm);
                const calc = calculateKasiFare(km);
                setAutoFare(calc);
                setFare(String(calc));
              }}
            >
              Auto-calc fare
            </button>
          </div>

          {calcInfo && <p className="text-sm opacity-70 mt-2">{calcInfo}</p>}
          {autoFare !== null && <p className="text-sm opacity-70 mt-1">Auto fare suggested: R{autoFare}</p>}
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <select
            className="border rounded-xl p-3 bg-transparent"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as any)}
          >
            <option value="cash">Cash</option>
            <option value="online">Online</option>
            <option value="other">Other</option>
          </select>

          <input
            className="border rounded-xl p-3"
            placeholder="Fare amount (auto or manual)"
            value={fare}
            onChange={(e) => setFare(e.target.value)}
          />

          <select
            className="border rounded-xl p-3 bg-transparent"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
          >
            <option value="">No driver (requested)</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.first_name} {d.last_name} ({d.phone})
              </option>
            ))}
          </select>
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <button disabled={busy} className="border rounded-xl px-4 py-2">
          {busy ? "Creating..." : "Create Trip"}
        </button>
      </form>
    </main>
  );
}