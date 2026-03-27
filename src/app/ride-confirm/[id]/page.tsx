"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Trip = {
  id: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  payment_method: string | null;
  fare_amount: number | null;
  status: string;
  offer_status: string | null;
  offer_expires_at: string | null;
  start_otp: string | null;
  end_otp: string | null;
  start_otp_verified: boolean | null;
  end_otp_verified: boolean | null;
};

type Driver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  vehicle_color?: string | null;
  vehicle_registration?: string | null;
};

type EventRow = {
  id: string;
  event_type: string;
  message: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
};

export default function RideConfirmPage() {
  const params = useParams<{ id: string }>();
  const tripId = params.id;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadStatus() {
    const res = await fetch(`/api/public/trip-status?tripId=${encodeURIComponent(tripId)}`, {
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Could not load trip status.");
      setLoading(false);
      return;
    }

    setTrip(json.trip ?? null);
    setDriver(json.driver ?? null);
    setEvents(json.events ?? []);
    setMsg(null);
    setLoading(false);
  }

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 4000);
    return () => clearInterval(t);
  }, [tripId]);

  if (loading) {
    return <main className="p-6">Loading trip status...</main>;
  }

  if (!trip) {
    return <main className="p-6">{msg || "Trip not found."}</main>;
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">MOOVU Rider</div>
          <h1 className="text-3xl font-semibold mt-1">Trip Status</h1>
          <p className="text-gray-700 mt-2">
            Status: <span className="font-medium">{trip.status}</span>
            {trip.offer_status ? ` • Offer: ${trip.offer_status}` : ""}
          </p>
        </div>

        {msg && <div className="border rounded-2xl p-4 text-sm">{msg}</div>}

        <section className="border rounded-2xl p-5 bg-white shadow-sm space-y-4">
          <h2 className="font-semibold">Trip Details</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Pickup</div>
              <div className="font-medium mt-1">{trip.pickup_address ?? "—"}</div>
            </div>
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Dropoff</div>
              <div className="font-medium mt-1">{trip.dropoff_address ?? "—"}</div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Fare</div>
              <div className="font-medium mt-1">
                {trip.fare_amount != null ? `R${Number(trip.fare_amount).toFixed(2)}` : "—"}
              </div>
            </div>
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Payment</div>
              <div className="font-medium mt-1 capitalize">{trip.payment_method ?? "—"}</div>
            </div>
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Status</div>
              <div className="font-medium mt-1">{trip.status}</div>
            </div>
          </div>
        </section>

        <section className="border rounded-2xl p-5 bg-white shadow-sm space-y-4">
          <h2 className="font-semibold">Your OTPs</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">Start OTP</div>
              <div className="text-2xl font-semibold mt-2">{trip.start_otp ?? "—"}</div>
              <div className="text-sm opacity-70 mt-2">
                Verified: {trip.start_otp_verified ? "Yes" : "No"}
              </div>
            </div>
            <div className="border rounded-xl p-4">
              <div className="text-sm opacity-70">End OTP</div>
              <div className="text-2xl font-semibold mt-2">{trip.end_otp ?? "—"}</div>
              <div className="text-sm opacity-70 mt-2">
                Verified: {trip.end_otp_verified ? "Yes" : "No"}
              </div>
            </div>
          </div>
        </section>

        <section className="border rounded-2xl p-5 bg-white shadow-sm space-y-4">
          <h2 className="font-semibold">Driver & Vehicle</h2>

          {!driver ? (
            <div className="opacity-70">A driver has not been assigned yet.</div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border rounded-xl p-4">
                <div className="text-sm opacity-70">Driver</div>
                <div className="font-medium mt-1">
                  {driver.first_name ?? "—"} {driver.last_name ?? ""}
                </div>
                <div className="text-sm opacity-70 mt-2">{driver.phone ?? "—"}</div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-sm opacity-70">Vehicle</div>
                <div className="font-medium mt-1">
                  {[driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(" ") || "—"}
                </div>
                <div className="text-sm opacity-70 mt-2">
                  {[driver.vehicle_year, driver.vehicle_color, driver.vehicle_registration]
                    .filter(Boolean)
                    .join(" • ") || "—"}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="border rounded-2xl p-5 bg-white shadow-sm space-y-3">
          <h2 className="font-semibold">Trip Timeline</h2>

          {events.length === 0 ? (
            <div className="opacity-70">No events yet.</div>
          ) : (
            events.map((e) => (
              <div key={e.id} className="border rounded-xl p-4">
                <div className="font-medium">{e.event_type}</div>
                {e.message && <div className="text-sm opacity-80 mt-2">{e.message}</div>}
                <div className="text-xs opacity-60 mt-2">
                  {new Date(e.created_at).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  );
}