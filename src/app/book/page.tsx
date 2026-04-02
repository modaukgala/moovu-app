"use client";

import { useEffect, useMemo, useRef, useState } from "react";

declare global {
  interface Window {
    google: typeof google;
  }
}

function wholeRand(value: number | null | undefined) {
  return value == null ? null : Math.round(Number(value));
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
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [fare, setFare] = useState<number | null>(null);

  const pickupInputRef = useRef<HTMLInputElement | null>(null);
  const dropoffInputRef = useRef<HTMLInputElement | null>(null);
  const pickupAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const dropoffAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const autoInitDoneRef = useRef(false);

  const canCalculate = useMemo(() => {
    return (
      pickupLat != null &&
      pickupLng != null &&
      dropoffLat != null &&
      dropoffLng != null &&
      pickupAddress.trim().length > 0 &&
      dropoffAddress.trim().length > 0
    );
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng, pickupAddress, dropoffAddress]);

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

  function resetRouteState() {
    setDistanceKm(null);
    setDurationMin(null);
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

        setPickupLat(lat);
        setPickupLng(lng);
        resetRouteState();

        const json = await reverseGeocode(lat, lng);

        if (json.ok) {
          const addr = json.address ?? "Current location";
          setPickupAddress(addr);
          if (pickupInputRef.current) pickupInputRef.current.value = addr;
          setMsg("Current pickup location detected ✅");
        } else {
          setPickupAddress("Current location");
          if (pickupInputRef.current) pickupInputRef.current.value = "Current location";
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

  function initAutocomplete() {
    if (!window.google?.maps?.places) return;
    if (!pickupInputRef.current || !dropoffInputRef.current) return;
    if (autoInitDoneRef.current) return;

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
      resetRouteState();
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
      resetRouteState();
      setMsg("Destination selected ✅");
    });

    autoInitDoneRef.current = true;
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
      setMsg("Select pickup and destination from the address fields first.");
      return;
    }

    if (!window.google?.maps) {
      setMsg("Google Maps is not loaded.");
      return;
    }

    const service = new window.google.maps.DistanceMatrixService();

    service.getDistanceMatrix(
      {
        origins: [{ lat: pickupLat!, lng: pickupLng! }],
        destinations: [{ lat: dropoffLat!, lng: dropoffLng! }],
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (
        response: google.maps.DistanceMatrixResponse | null,
        status: google.maps.DistanceMatrixStatus
      ) => {
        if (status !== "OK" || !response) {
          setMsg("Could not calculate trip distance.");
          return;
        }

        const el = response.rows?.[0]?.elements?.[0];
        if (!el || el.status !== "OK") {
          setMsg("No route found.");
          return;
        }

        const meters = el.distance?.value ?? 0;
        const seconds = el.duration?.value ?? 0;

        const km = meters / 1000;
        const mins = seconds / 60;

        const estimatedFare = Math.max(40, 25 + km * 7 + mins * 1.2);

        setDistanceKm(Number(km.toFixed(2)));
        setDurationMin(Math.ceil(mins));
        setFare(Math.round(estimatedFare));
        setMsg("Fare calculated ✅");
      }
    );
  }

  async function submitBooking() {
    setMsg(null);

    if (!riderName.trim() || !riderPhone.trim()) {
      setMsg("Enter rider name and phone.");
      return;
    }

    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      setMsg("Pickup and destination are required.");
      return;
    }

    if (!canCalculate) {
      setMsg("Select pickup and destination from the address fields first.");
      return;
    }

    if (distanceKm == null || durationMin == null) {
      setMsg("Calculate fare first.");
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/public/book-trip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          riderName,
          riderPhone,
          pickupAddress,
          dropoffAddress,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          paymentMethod,
          distanceKm,
          durationMin,
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
        window.location.href = `/ride-confirm/${tripId}`;
        return;
      }

      setMsg(`Trip booked successfully ✅ Fare: R${bookedFare ?? 0}`);
    } catch (e: any) {
      setMsg(e?.message || "Could not create trip.");
    }

    setBusy(false);
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">MOOVU Rider</div>
          <h1 className="text-3xl font-semibold mt-1">Book a Ride</h1>
          <p className="text-gray-700 mt-2">
            Enter pickup and destination, calculate the fare, then request your ride.
          </p>
        </div>

        {msg && (
          <div
            className="border rounded-2xl p-4 text-sm"
            style={{ background: "var(--moovu-primary-soft)" }}
          >
            {msg}
          </div>
        )}

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Rider Details</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <input
              className="border rounded-xl p-3"
              placeholder="Full name"
              value={riderName}
              onChange={(e) => setRiderName(e.target.value)}
            />

            <input
              className="border rounded-xl p-3"
              placeholder="Phone number"
              value={riderPhone}
              onChange={(e) => setRiderPhone(e.target.value)}
            />
          </div>
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

            <input
              ref={pickupInputRef}
              className="border rounded-xl p-3 w-full"
              placeholder={mapsReady ? "Pickup address" : "Loading maps..."}
              defaultValue={pickupAddress}
              onChange={(e) => {
                setPickupAddress(e.target.value);
                setPickupLat(null);
                setPickupLng(null);
                resetRouteState();
              }}
            />

            <input
              ref={dropoffInputRef}
              className="border rounded-xl p-3 w-full"
              placeholder={mapsReady ? "Destination address" : "Loading maps..."}
              defaultValue={dropoffAddress}
              onChange={(e) => {
                setDropoffAddress(e.target.value);
                setDropoffLat(null);
                setDropoffLng(null);
                resetRouteState();
              }}
            />

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
              {busy ? "Booking..." : "Book Ride"}
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
      </div>
    </main>
  );
}