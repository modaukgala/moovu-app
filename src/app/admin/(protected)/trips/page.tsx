"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabase/client";

type Trip = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string;
  dropoff_address: string;
  payment_method: string;
  fare_amount: number | null;
  status: string;
  created_at: string;
  driver_id: string | null;
};

type Driver = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  status: string;
};

const STATUSES = ["all", "requested", "assigned", "arrived", "started", "completed", "cancelled"] as const;

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");

  async function loadDrivers() {
    const { data } = await supabaseClient
      .from("drivers")
      .select("id, first_name, last_name, phone, status")
      .in("status", ["approved", "active"])
      .order("created_at", { ascending: false });

    setDrivers((data as any) ?? []);
  }

  async function loadTrips(s: string) {
    setLoading(true);

    let q = supabaseClient
      .from("trips")
      .select("*")
      .order("created_at", { ascending: false });

    if (s !== "all") q = q.eq("status", s);

    const { data } = await q;
    setTrips((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadDrivers();
    loadTrips(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const driverNameById = useMemo(() => {
    const m = new Map<string, string>();
    drivers.forEach((d) => m.set(d.id, `${d.first_name} ${d.last_name}`));
    return m;
  }, [drivers]);

  async function assignDriver(tripId: string, driverId: string) {
    // set trip driver + status
    await supabaseClient.from("trips").update({ driver_id: driverId, status: "assigned" }).eq("id", tripId);

    // add timeline event
    await supabaseClient.from("trip_events").insert({
      trip_id: tripId,
      event_type: "assignment",
      message: `Assigned driver ${driverId}`,
      old_status: "requested",
      new_status: "assigned",
    });

    await loadTrips(status);
  }

  async function updateStatus(tripId: string, newStatus: string) {
    const trip = trips.find((t) => t.id === tripId);
    const oldStatus = trip?.status ?? null;

    await supabaseClient.from("trips").update({ status: newStatus }).eq("id", tripId);

    await supabaseClient.from("trip_events").insert({
      trip_id: tripId,
      event_type: "status_change",
      message: `Status changed to ${newStatus}`,
      old_status: oldStatus,
      new_status: newStatus,
    });

    await loadTrips(status);
  }

  return (
    <main className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Trips</h1>
          <p className="opacity-70 mt-1">Dispatcher console (manual + smart ops).</p>
        </div>

        <Link className="border rounded-xl px-4 py-2" href="/admin/trips/new">
          + New Trip
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`border rounded-full px-4 py-2 text-sm ${
              status === s ? "bg-white/10" : ""
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div>Loading trips...</div>
      ) : trips.length === 0 ? (
        <div className="opacity-70">No trips found.</div>
      ) : (
        <div className="border rounded-2xl overflow-hidden">
          <div className="grid grid-cols-12 gap-0 bg-white/5 text-sm font-medium">
            <div className="col-span-3 p-3">Pickup → Dropoff</div>
            <div className="col-span-2 p-3">Rider</div>
            <div className="col-span-2 p-3">Driver</div>
            <div className="col-span-1 p-3">Pay</div>
            <div className="col-span-1 p-3">Fare</div>
            <div className="col-span-1 p-3">Status</div>
            <div className="col-span-2 p-3">Actions</div>
          </div>

          {trips.map((t) => (
            <div key={t.id} className="grid grid-cols-12 gap-0 border-t text-sm">
            <div className="col-span-3 p-3">
                <a className="underline underline-offset-4 hover:opacity-80" href={`/admin/trips/${t.id}`}>
                    <div className="font-medium">{t.pickup_address}</div>
                    <div className="opacity-70 mt-1">{t.dropoff_address}</div>
                </a>
            </div>

              <div className="col-span-2 p-3">
                <div className="font-medium">{t.rider_name ?? "—"}</div>
                <div className="opacity-70 mt-1">{t.rider_phone ?? "—"}</div>
              </div>

              <div className="col-span-2 p-3">
                {t.driver_id ? (
                  <div className="font-medium">{driverNameById.get(t.driver_id) ?? t.driver_id}</div>
                ) : (
                  <div className="opacity-70">Unassigned</div>
                )}

                {/* quick assign */}
                {!t.driver_id && (
                  <select
                    className="mt-2 w-full border rounded-xl p-2 bg-transparent"
                    defaultValue=""
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) assignDriver(t.id, val);
                    }}
                  >
                    <option value="" disabled>
                      Assign driver...
                    </option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.first_name} {d.last_name} ({d.phone})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="col-span-1 p-3 capitalize">{t.payment_method}</div>
              <div className="col-span-1 p-3">{t.fare_amount ?? "—"}</div>
              <div className="col-span-1 p-3 capitalize">{t.status}</div>

              <div className="col-span-2 p-3 flex flex-wrap gap-2">
                {t.status === "assigned" && (
                  <button className="border rounded-lg px-3 py-1" onClick={() => updateStatus(t.id, "arrived")}>
                    Arrived
                  </button>
                )}
                {t.status === "arrived" && (
                  <button className="border rounded-lg px-3 py-1" onClick={() => updateStatus(t.id, "started")}>
                    Start
                  </button>
                )}
                {t.status === "started" && (
                  <button className="border rounded-lg px-3 py-1" onClick={() => updateStatus(t.id, "completed")}>
                    Complete
                  </button>
                )}
                {t.status !== "completed" && t.status !== "cancelled" && (
                  <button className="border rounded-lg px-3 py-1" onClick={() => updateStatus(t.id, "cancelled")}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}