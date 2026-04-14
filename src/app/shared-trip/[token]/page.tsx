"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type SharedTrip = {
  id: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  status: string;
  fare_amount: number | null;
  created_at: string | null;
};

type SharedDriver = {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  vehicle_registration?: string | null;
};

export default function SharedTripPage() {
  const params = useParams<{ token: string }>();

  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [driver, setDriver] = useState<SharedDriver | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadSharedTrip() {
    setLoading(true);
    setMsg(null);

    const res = await fetch(
      `/api/customer/shared-trip?token=${encodeURIComponent(params.token)}`,
      { cache: "no-store" }
    );

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Could not load shared trip.");
      setLoading(false);
      return;
    }

    setTrip(json.trip ?? null);
    setDriver(json.driver ?? null);
    setLoading(false);
  }

  useEffect(() => {
    loadSharedTrip();
    const timer = setInterval(loadSharedTrip, 4000);
    return () => clearInterval(timer);
  }, [params.token]);

  if (loading) {
    return <main className="p-6 text-black">Loading shared trip...</main>;
  }

  if (!trip) {
    return <main className="p-6 text-black">{msg || "Shared trip not found."}</main>;
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">MOOVU Shared Trip</div>
          <h1 className="text-3xl font-semibold mt-1">Live Trip Share</h1>
          <p className="text-gray-700 mt-2">
            You are viewing a customer’s shared MOOVU trip.
          </p>
        </div>

        {msg && (
          <div className="border rounded-2xl p-4 text-sm">
            {msg}
          </div>
        )}

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm text-gray-500">Pickup</div>
              <div className="font-medium mt-1">{trip.pickup_address ?? "—"}</div>
            </div>

            <div className="border rounded-xl p-4">
              <div className="text-sm text-gray-500">Dropoff</div>
              <div className="font-medium mt-1">{trip.dropoff_address ?? "—"}</div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm text-gray-500">Status</div>
              <div className="font-medium mt-1">{trip.status}</div>
            </div>

            <div className="border rounded-xl p-4">
              <div className="text-sm text-gray-500">Fare</div>
              <div className="font-medium mt-1">R{Number(trip.fare_amount ?? 0).toFixed(2)}</div>
            </div>

            <div className="border rounded-xl p-4">
              <div className="text-sm text-gray-500">Requested</div>
              <div className="font-medium mt-1">
                {trip.created_at ? new Date(trip.created_at).toLocaleString() : "—"}
              </div>
            </div>
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Driver & Vehicle</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-xl p-4">
              <div className="text-sm text-gray-500">Driver</div>
              <div className="font-medium mt-1">
                {driver ? `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() : "—"}
              </div>
              <div className="text-sm text-gray-600 mt-2">{driver?.phone ?? "—"}</div>
            </div>

            <div className="border rounded-xl p-4">
              <div className="text-sm text-gray-500">Vehicle</div>
              <div className="font-medium mt-1">
                {[driver?.vehicle_color, driver?.vehicle_make, driver?.vehicle_model]
                  .filter(Boolean)
                  .join(" ") || "—"}
              </div>
              <div className="text-sm text-gray-600 mt-2">
                {driver?.vehicle_registration ?? "—"}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}