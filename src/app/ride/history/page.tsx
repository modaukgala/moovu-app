"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type RiderTrip = {
  id: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  status: string | null;
  created_at: string | null;
  driver_id: string | null;
  cancel_reason?: string | null;
};

function money(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `R${n.toFixed(2)}`;
}

export default function RiderHistoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [trips, setTrips] = useState<RiderTrip[]>([]);
  const [filter, setFilter] = useState("all");

  async function loadTrips() {
    setLoading(true);
    setMsg(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      router.replace("/customer/auth?next=/ride/history");
      return;
    }

    const res = await fetch("/api/customer/trips", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load trip history.");
      setLoading(false);
      return;
    }

    setTrips(json.trips ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadTrips();
  }, []);

  const filteredTrips = useMemo(() => {
    if (filter === "all") return trips;
    return trips.filter((t) => t.status === filter);
  }, [trips, filter]);

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">MOOVU Rider</div>
            <h1 className="text-3xl font-semibold mt-1">My Trip History</h1>
            <p className="text-gray-700 mt-2">
              These are the trips saved under your customer account.
            </p>
          </div>

          <Link href="/" className="border rounded-xl px-4 py-2 bg-white">
            Back Home
          </Link>
        </div>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Filters</h2>

          <div className="flex flex-wrap gap-2">
            {["all", "completed", "cancelled", "ongoing", "assigned", "requested"].map((value) => (
              <button
                key={value}
                className="border rounded-xl px-4 py-2 bg-white"
                onClick={() => setFilter(value)}
              >
                {value === "all" ? "All" : value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Trips</h2>

          {loading ? (
            <p className="text-gray-700">Loading trips...</p>
          ) : filteredTrips.length === 0 ? (
            <p className="text-gray-700">No trips found yet.</p>
          ) : (
            <div className="space-y-3">
              {filteredTrips.map((trip) => (
                <div key={trip.id} className="border rounded-2xl p-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-gray-600">Pickup</div>
                      <div className="font-medium">{trip.pickup_address ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Dropoff</div>
                      <div className="font-medium">{trip.dropoff_address ?? "—"}</div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-5 gap-4 mt-4">
                    <div>
                      <div className="text-sm text-gray-600">Trip ID</div>
                      <div className="font-medium break-all">{trip.id}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Fare</div>
                      <div className="font-medium">{money(trip.fare_amount)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Payment</div>
                      <div className="font-medium">{trip.payment_method ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Status</div>
                      <div className="font-medium">{trip.status ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Date</div>
                      <div className="font-medium">
                        {trip.created_at
                          ? new Date(trip.created_at).toLocaleString()
                          : "—"}
                      </div>
                    </div>
                  </div>

                  {trip.cancel_reason && (
                    <div className="mt-3 text-sm text-red-600">
                      Cancellation reason: {trip.cancel_reason}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                      href={`/ride/${trip.id}`}
                      className="border rounded-xl px-4 py-2 bg-white inline-block"
                    >
                      Open Trip
                    </Link>

                    <Link
                      href={`/ride/${trip.id}/receipt`}
                      className="border rounded-xl px-4 py-2 bg-white inline-block"
                    >
                      Receipt
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}