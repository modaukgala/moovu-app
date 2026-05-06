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

type PaymentMethod = "cash" | "online" | "other";

function isPaymentMethod(value: string): value is PaymentMethod {
  return value === "cash" || value === "online" || value === "other";
}

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export default function NewTripPage() {
  const router = useRouter();

  const [riderName, setRiderName] = useState("");
  const [riderPhone, setRiderPhone] = useState("");

  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [pickupPlaceId, setPickupPlaceId] = useState<string | null>(null);
  const [dropoffPlaceId, setDropoffPlaceId] = useState<string | null>(null);

  const [pickupPred, setPickupPred] = useState<Prediction[]>([]);
  const [dropoffPred, setDropoffPred] = useState<Prediction[]>([]);
  const [pickupOpen, setPickupOpen] = useState(false);
  const [dropoffOpen, setDropoffOpen] = useState(false);
  const pickupTimer = useRef<number | null>(null);
  const dropoffTimer = useRef<number | null>(null);

  const [distanceKm, setDistanceKm] = useState("3");
  const [durationMin, setDurationMin] = useState("");
  const [autoFare, setAutoFare] = useState<number | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [fare, setFare] = useState<string>("");

  const [driverId, setDriverId] = useState<string>("");
  const [drivers, setDrivers] = useState<Driver[]>([]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [calcBusy, setCalcBusy] = useState(false);
  const [calcInfo, setCalcInfo] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabaseClient
        .from("drivers")
        .select("id, first_name, last_name, phone, status")
        .in("status", ["approved", "active"])
        .order("created_at", { ascending: false });

      setDrivers((data as Driver[]) ?? []);
    })();
  }, []);

  async function fetchPredictions(input: string): Promise<Prediction[]> {
    const res = await fetch("/api/maps/autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    const json = await res.json();
    if (!json.ok) return [];
    return (json.predictions ?? []) as Prediction[];
  }

  function schedulePickupAutocomplete(value: string) {
    if (pickupTimer.current) window.clearTimeout(pickupTimer.current);
    pickupTimer.current = window.setTimeout(async () => {
      if (value.trim().length < 3) {
        setPickupPred([]);
        return;
      }
      const preds = await fetchPredictions(value.trim());
      setPickupPred(preds);
      setPickupOpen(true);
    }, 250);
  }

  function scheduleDropoffAutocomplete(value: string) {
    if (dropoffTimer.current) window.clearTimeout(dropoffTimer.current);
    dropoffTimer.current = window.setTimeout(async () => {
      if (value.trim().length < 3) {
        setDropoffPred([]);
        return;
      }
      const preds = await fetchPredictions(value.trim());
      setDropoffPred(preds);
      setDropoffOpen(true);
    }, 250);
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

    const km = Number(json.distanceKm);
    const calcFare = calculateKasiFare(km);
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

    const km = Number(distanceKm);
    if (!Number.isFinite(km) || km <= 0) {
      setErr("Distance (km) is required (use Calculate distance).");
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
    const completionOtp = generateOtp();

    const { data: trip, error } = await supabaseClient
      .from("trips")
      .insert({
        created_by: createdBy,
        rider_name: riderName || null,
        rider_phone: riderPhone || null,
        pickup_address: pickup.trim(),
        dropoff_address: dropoff.trim(),
        payment_method: paymentMethod,
        fare_amount: finalFare,
        distance_km: km,
        duration_min: durationMin ? Number(durationMin) : null,
        status: initialStatus,
        driver_id: driverId || null,
        completion_otp: completionOtp,
        otp_verified: false,
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
      message: `Trip created. Rider OTP: ${completionOtp}`,
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

        <div className="relative">
          <input
            className="border rounded-xl p-3 w-full"
            placeholder="Pickup (select from suggestions) *"
            value={pickup}
            onChange={(e) => {
              const v = e.target.value;
              setPickup(v);
              setPickupPlaceId(null);
              schedulePickupAutocomplete(v);
            }}
            onFocus={() => pickupPred.length && setPickupOpen(true)}
            required
          />
          {pickupOpen && pickupPred.length > 0 && (
            <div className="absolute z-10 mt-2 w-full border rounded-2xl bg-white text-black overflow-hidden shadow">
              {pickupPred.slice(0, 6).map((p) => (
                <button
                  type="button"
                  key={p.place_id}
                  className="w-full text-left px-4 py-3 hover:bg-black/5"
                  onClick={() => {
                    setPickup(p.description);
                    setPickupPlaceId(p.place_id);
                    setPickupOpen(false);
                    setPickupPred([]);
                  }}
                >
                  {p.description}
                </button>
              ))}
            </div>
          )}
          {pickup && !pickupPlaceId && (
            <p className="text-xs opacity-70 mt-1">Pick from suggestions so distance can be calculated.</p>
          )}
        </div>

        <div className="relative">
          <input
            className="border rounded-xl p-3 w-full"
            placeholder="Dropoff (select from suggestions) *"
            value={dropoff}
            onChange={(e) => {
              const v = e.target.value;
              setDropoff(v);
              setDropoffPlaceId(null);
              scheduleDropoffAutocomplete(v);
            }}
            onFocus={() => dropoffPred.length && setDropoffOpen(true)}
            required
          />
          {dropoffOpen && dropoffPred.length > 0 && (
            <div className="absolute z-10 mt-2 w-full border rounded-2xl bg-white text-black overflow-hidden shadow">
              {dropoffPred.slice(0, 6).map((p) => (
                <button
                  type="button"
                  key={p.place_id}
                  className="w-full text-left px-4 py-3 hover:bg-black/5"
                  onClick={() => {
                    setDropoff(p.description);
                    setDropoffPlaceId(p.place_id);
                    setDropoffOpen(false);
                    setDropoffPred([]);
                  }}
                >
                  {p.description}
                </button>
              ))}
            </div>
          )}
          {dropoff && !dropoffPlaceId && (
            <p className="text-xs opacity-70 mt-1">Pick from suggestions so distance can be calculated.</p>
          )}
        </div>

        <div className="border rounded-2xl p-4">
          <div className="font-semibold">Smart Kasi Pricing</div>
          <div className="text-sm opacity-70 mt-1">
            Base R60 (≤ 3km). Above 3km: +R10 per started km.
          </div>

          <div className="grid md:grid-cols-4 gap-3 mt-4">
            <input
              className="border rounded-xl p-3"
              placeholder="Distance (km)"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
            />

            <input
              className="border rounded-xl p-3"
              placeholder="Duration (min)"
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
            onChange={(e) => {
              if (isPaymentMethod(e.target.value)) {
                setPaymentMethod(e.target.value);
              }
            }}
          >
            <option value="cash">Cash</option>
            <option value="online">Online</option>
            <option value="other">Other</option>
          </select>

          <input
            className="border rounded-xl p-3"
            placeholder="Fare (auto or manual)"
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
