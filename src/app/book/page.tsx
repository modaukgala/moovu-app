"use client";

import { useEffect, useMemo, useRef, useState } from "react";

declare global {
  interface Window {
    google: typeof google;
  }
}

function calcFare(distanceKm: number): number {
  if (distanceKm <= 3) return 60;
  return 60 + Math.ceil(distanceKm - 3) * 10;
}

export default function RiderBookingPage() {
  const [riderName, setRiderName] = useState("");
  const [riderPhone, setRiderPhone] = useState("");

  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");

  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);
  const [dropoffLat, setDropoffLat] = useState<number | null>(null);
  const [dropoffLng, setDropoffLng] = useState<number | null>(null);

  const [paymentMethod, setPaymentMethod] = useState("cash");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [mapsReady, setMapsReady] = useState(false);

  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [fare, setFare] = useState<number | null>(null);

  const pickupInputRef = useRef<HTMLInputElement | null>(null);
  const dropoffInputRef = useRef<HTMLInputElement | null>(null);

  const pickupAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const dropoffAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const canCalculate = useMemo(() => {
    return (
      pickupLat != null &&
      pickupLng != null &&
      dropoffLat != null &&
      dropoffLng != null
    );
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng]);

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

  function resetFare() {
    setDistanceKm(null);
    setFare(null);
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
        const accuracy = pos.coords.accuracy;

        setPickupLat(lat);
        setPickupLng(lng);
        resetFare();

        const json = await reverseGeocode(lat, lng);

        if (json.ok) {
          setPickupAddress(json.address ?? "Current location");
          if (pickupInputRef.current) pickupInputRef.current.value = json.address ?? "Current location";
          setMsg(`Current pickup location detected ✅ (accuracy about ${Math.round(accuracy)}m)`);
        } else {
          setPickupAddress("Current location");
          if (pickupInputRef.current) pickupInputRef.current.value = "Current location";
          setMsg(`Location detected, but address name could not be resolved. Accuracy about ${Math.round(accuracy)}m`);
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

  function initAutocomplete() {
    if (!window.google?.maps?.places) return;
    if (!pickupInputRef.current || !dropoffInputRef.current) return;

    pickupAutocompleteRef.current = new window.google.maps.places.Autocomplete(
      pickupInputRef.current,
      {
        fields: ["formatted_address", "geometry", "name"],
      }
    );

    dropoffAutocompleteRef.current = new window.google.maps.places.Autocomplete(
      dropoffInputRef.current,
      {
        fields: ["formatted_address", "geometry", "name"],
      }
    );

    pickupAutocompleteRef.current.addListener("place_changed", () => {
      const place = pickupAutocompleteRef.current?.getPlace();
      const lat = place?.geometry?.location?.lat();
      const lng = place?.geometry?.location?.lng();

      const addr =
        place?.formatted_address ||
        place?.name ||
        pickupInputRef.current?.value ||
        "";

      setPickupAddress(addr);
      setPickupLat(typeof lat === "number" ? lat : null);
      setPickupLng(typeof lng === "number" ? lng : null);
      resetFare();
      setMsg("Pickup selected ✅");
    });

    dropoffAutocompleteRef.current.addListener("place_changed", () => {
      const place = dropoffAutocompleteRef.current?.getPlace();
      const lat = place?.geometry?.location?.lat();
      const lng = place?.geometry?.location?.lng();

      const addr =
        place?.formatted_address ||
        place?.name ||
        dropoffInputRef.current?.value ||
        "";

      setDropoffAddress(addr);
      setDropoffLat(typeof lat === "number" ? lat : null);
      setDropoffLng(typeof lng === "number" ? lng : null);
      resetFare();
      setMsg("Destination selected ✅");
    });
  }

  useEffect(() => {
    if (window.google?.maps?.places) {
      setMapsReady(true);
      initAutocomplete();
      return;
    }

    const timer = setInterval(() => {
      if (window.google?.maps?.places) {
        setMapsReady(true);
        initAutocomplete();
        clearInterval(timer);
      }
    }, 500);

    return () => clearInterval(timer);
  }, []);

  async function calculateTrip() {
    setMsg(null);

    if (!canCalculate) {
      setMsg("Set pickup and destination first");
      return;
    }

    if (!window.google?.maps) {
      setMsg("Google Maps is not loaded");
      return;
    }

    const service = new window.google.maps.DistanceMatrixService();

    service.getDistanceMatrix(
      {
        origins: [{ lat: pickupLat!, lng: pickupLng! }],
        destinations: [{ lat: dropoffLat!, lng: dropoffLng! }],
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (response, status) => {
        if (status !== "OK" || !response) {
          setMsg("Could not calculate trip distance");
          return;
        }

        const el = response.rows?.[0]?.elements?.[0];
        if (!el || el.status !== "OK") {
          setMsg("No route found");
          return;
        }

        const meters = el.distance?.value ?? 0;
        const km = meters / 1000;
        const tripFare = calcFare(km);

        setDistanceKm(Number(km.toFixed(2)));
        setFare(tripFare);
        setMsg("Fare calculated ✅");
      }
    );
  }

  async function submitBooking() {
    setMsg(null);

    if (!riderName.trim() || !riderPhone.trim()) {
      setMsg("Enter rider name and phone");
      return;
    }

    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      setMsg("Pickup and destination are required");
      return;
    }

    if (!canCalculate) {
      setMsg("Set pickup and destination first");
      return;
    }

    if (fare == null) {
      setMsg("Calculate fare first");
      return;
    }

    setBusy(true);

    const res = await fetch("/api/public/book-trip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rider_name: riderName,
        rider_phone: riderPhone,
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        dropoff_lat: dropoffLat,
        dropoff_lng: dropoffLng,
        fare_amount: fare,
        payment_method: paymentMethod,
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Failed to create booking");
      return;
    }

    setMsg(`Booking created ✅ Redirecting to tracking page...`);
    window.location.href = `/ride-confirm/${json.tripId}`;
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.1fr_0.9fr] gap-8 items-start">
        <section className="space-y-6">
          <div className="space-y-3">
            <div
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm border bg-white/85"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: "var(--moovu-primary)" }}
              />
              Book your ride with MOOVU
            </div>

            <h1 className="text-4xl md:text-5xl font-semibold leading-tight">
              Fast local booking, with live driver tracking
            </h1>

            <p className="opacity-75 max-w-2xl">
              Set your pickup, choose your destination, calculate your fare and
              request your ride in a few simple steps.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="border rounded-2xl p-4 bg-white/85">
              <div className="font-semibold">Current location</div>
              <div className="text-sm opacity-70 mt-1">
                Use your live location as pickup
              </div>
            </div>
            <div className="border rounded-2xl p-4 bg-white/85">
              <div className="font-semibold">Smart fare</div>
              <div className="text-sm opacity-70 mt-1">
                Estimate your trip before requesting
              </div>
            </div>
            <div className="border rounded-2xl p-4 bg-white/85">
              <div className="font-semibold">Track live</div>
              <div className="text-sm opacity-70 mt-1">
                See driver details and ETA after booking
              </div>
            </div>
          </div>

          <div
            className="border rounded-[2rem] p-6 md:p-8"
            style={{
              background:
                "linear-gradient(145deg, rgba(201,232,218,0.38), rgba(169,210,242,0.32), rgba(255,255,255,0.96))",
            }}
          >
            <div className="space-y-2">
              <div className="text-sm opacity-60">Why riders choose MOOVU</div>
              <div className="text-2xl font-semibold">A cleaner kasi ride experience</div>
              <p className="opacity-75 max-w-xl">
                Built for convenience, visibility and smoother local operations
                from booking to drop-off.
              </p>
            </div>
          </div>
        </section>

        <section className="border rounded-[2rem] p-5 md:p-6 bg-white/90 shadow-sm">
          <div className="space-y-5">
            <div>
              <div className="text-sm opacity-60">Ride Request</div>
              <h2 className="text-2xl font-semibold mt-1">Book a Ride</h2>
            </div>

            {msg && (
              <div
                className="border rounded-2xl p-4 text-sm"
                style={{ background: "var(--moovu-primary-soft)" }}
              >
                {msg}
              </div>
            )}

            <section className="space-y-4">
              <div className="text-sm font-semibold">Rider Details</div>

              <input
                className="rounded-xl p-3 w-full"
                placeholder="Your name"
                value={riderName}
                onChange={(e) => setRiderName(e.target.value)}
              />

              <input
                className="rounded-xl p-3 w-full"
                placeholder="Phone number"
                value={riderPhone}
                onChange={(e) => setRiderPhone(e.target.value)}
              />
            </section>

            <section className="space-y-4">
              <div className="text-sm font-semibold">Trip Details</div>

              <div className="space-y-2">
                <div className="text-sm opacity-70">Pickup location</div>
                <div className="grid md:grid-cols-[1fr_auto] gap-3">
                  <input
                    ref={pickupInputRef}
                    className="rounded-xl p-3"
                    placeholder={mapsReady ? "Search pickup location" : "Loading maps..."}
                    defaultValue={pickupAddress}
                    onChange={(e) => {
                      setPickupAddress(e.target.value);
                      resetFare();
                    }}
                  />
                  <button
                    className="rounded-xl px-4 py-3 text-white"
                    style={{ background: "var(--moovu-primary)" }}
                    disabled={busy}
                    onClick={useCurrentLocation}
                  >
                    Current Location
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm opacity-70">Destination</div>
                <input
                  ref={dropoffInputRef}
                  className="rounded-xl p-3 w-full"
                  placeholder={mapsReady ? "Search destination" : "Loading maps..."}
                  defaultValue={dropoffAddress}
                  onChange={(e) => {
                    setDropoffAddress(e.target.value);
                    resetFare();
                  }}
                />
              </div>

              <select
                className="rounded-xl p-3 w-full bg-white"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="cash">Cash</option>
              </select>

              <button
                className="w-full rounded-xl px-4 py-3 text-white"
                style={{ background: "var(--moovu-primary)" }}
                onClick={calculateTrip}
              >
                Calculate Fare
              </button>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="border rounded-2xl p-4" style={{ background: "var(--moovu-primary-soft)" }}>
                  <div className="text-sm opacity-70">Distance</div>
                  <div className="text-2xl font-semibold mt-1">
                    {distanceKm != null ? `${distanceKm} km` : "—"}
                  </div>
                </div>

                <div className="border rounded-2xl p-4 bg-white">
                  <div className="text-sm opacity-70">Estimated Fare</div>
                  <div
                    className="text-2xl font-semibold mt-1"
                    style={{ color: "var(--moovu-primary)" }}
                  >
                    {fare != null ? `R${fare}` : "—"}
                  </div>
                </div>
              </div>
            </section>

            <button
              className="w-full rounded-2xl px-4 py-3 text-white text-base font-medium"
              style={{ background: "var(--moovu-primary)" }}
              disabled={busy}
              onClick={submitBooking}
            >
              {busy ? "Submitting..." : "Book Ride"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}