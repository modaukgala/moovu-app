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
    await supabaseClient.from("trips").update({ driver_id: driverId, status: "assigned" }).eq("id", tripId);

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

  function statusPillClass(s: string) {
    switch (s) {
      case "requested":
        return "bg-white text-black border";
      case "assigned":
        return "text-white";
      case "arrived":
        return "bg-amber-100 text-amber-800 border border-amber-200";
      case "started":
        return "bg-emerald-100 text-emerald-800 border border-emerald-200";
      case "completed":
        return "bg-green-100 text-green-800 border border-green-200";
      case "cancelled":
        return "bg-red-100 text-red-800 border border-red-200";
      default:
        return "bg-white text-black border";
    }
  }

  return (
    <main className="space-y-6 text-black">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">Trips Management</div>
          <h1 className="text-3xl font-semibold text-black mt-1">Trips</h1>
          <p className="text-gray-700 mt-2">Dispatcher console for manual assignment and trip operations.</p>
        </div>

        <Link
          className="rounded-xl px-4 py-2 text-white"
          style={{ background: "var(--moovu-primary)" }}
          href="/admin/trips/new"
        >
          + New Trip
        </Link>
      </div>

      <section className="border rounded-[2rem] p-5 bg-white shadow-sm space-y-4">
        <div>
          <div className="text-sm text-gray-500">Filter Trips</div>
          <h2 className="text-xl font-semibold text-black mt-1">Status Filters</h2>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => {
            const active = status === s;
            return (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className="rounded-full px-4 py-2 text-sm border transition"
                style={
                  active
                    ? { background: "var(--moovu-primary)", color: "white", borderColor: "var(--moovu-primary)" }
                    : { background: "white", color: "black" }
                }
              >
                {s}
              </button>
            );
          })}
        </div>
      </section>

      {loading ? (
        <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
          <div className="text-gray-700">Loading trips...</div>
        </section>
      ) : trips.length === 0 ? (
        <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
          <div className="text-gray-700">No trips found.</div>
        </section>
      ) : (
        <section className="border rounded-[2rem] bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b">
            <div className="text-sm text-gray-500">Trips List</div>
            <h2 className="text-xl font-semibold text-black mt-1">All matching trips</h2>
          </div>

          <div className="hidden xl:grid grid-cols-12 gap-0 border-b bg-gray-50 text-sm font-semibold text-black">
            <div className="col-span-3 p-4">Pickup → Dropoff</div>
            <div className="col-span-2 p-4">Rider</div>
            <div className="col-span-2 p-4">Driver</div>
            <div className="col-span-1 p-4">Pay</div>
            <div className="col-span-1 p-4">Fare</div>
            <div className="col-span-1 p-4">Status</div>
            <div className="col-span-2 p-4">Actions</div>
          </div>

          <div className="divide-y">
            {trips.map((t) => (
              <div key={t.id} className="xl:grid xl:grid-cols-12 xl:gap-0 p-5 xl:p-0">
                <div className="xl:col-span-3 xl:p-4 space-y-1">
                  <div className="xl:hidden text-xs text-gray-500">Pickup → Dropoff</div>
                  <Link className="hover:opacity-80" href={`/admin/trips/${t.id}`}>
                    <div className="font-semibold text-black">{t.pickup_address}</div>
                    <div className="text-gray-600 mt-1">{t.dropoff_address}</div>
                  </Link>
                </div>

                <div className="xl:col-span-2 xl:p-4 mt-4 xl:mt-0 space-y-1">
                  <div className="xl:hidden text-xs text-gray-500">Rider</div>
                  <div className="font-medium text-black">{t.rider_name ?? "—"}</div>
                  <div className="text-gray-600">{t.rider_phone ?? "—"}</div>
                </div>

                <div className="xl:col-span-2 xl:p-4 mt-4 xl:mt-0 space-y-2">
                  <div className="xl:hidden text-xs text-gray-500">Driver</div>

                  {t.driver_id ? (
                    <div className="font-medium text-black">{driverNameById.get(t.driver_id) ?? t.driver_id}</div>
                  ) : (
                    <div className="text-gray-600">Unassigned</div>
                  )}

                  {!t.driver_id && (
                    <select
                      className="w-full border rounded-xl p-2 bg-white text-black"
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

                <div className="xl:col-span-1 xl:p-4 mt-4 xl:mt-0">
                  <div className="xl:hidden text-xs text-gray-500 mb-1">Payment</div>
                  <div className="capitalize text-black">{t.payment_method}</div>
                </div>

                <div className="xl:col-span-1 xl:p-4 mt-4 xl:mt-0">
                  <div className="xl:hidden text-xs text-gray-500 mb-1">Fare</div>
                  <div className="text-black font-medium">{t.fare_amount ?? "—"}</div>
                </div>

                <div className="xl:col-span-1 xl:p-4 mt-4 xl:mt-0">
                  <div className="xl:hidden text-xs text-gray-500 mb-1">Status</div>
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${statusPillClass(t.status)}`}
                    style={t.status === "assigned" ? { background: "var(--moovu-primary)" } : undefined}
                  >
                    {t.status}
                  </span>
                </div>

                <div className="xl:col-span-2 xl:p-4 mt-4 xl:mt-0">
                  <div className="xl:hidden text-xs text-gray-500 mb-2">Actions</div>
                  <div className="flex flex-wrap gap-2">
                    {t.status === "assigned" && (
                      <button
                        className="rounded-lg px-3 py-2 text-white"
                        style={{ background: "var(--moovu-primary)" }}
                        onClick={() => updateStatus(t.id, "arrived")}
                      >
                        Arrived
                      </button>
                    )}

                    {t.status === "arrived" && (
                      <button
                        className="rounded-lg px-3 py-2 text-white"
                        style={{ background: "var(--moovu-primary)" }}
                        onClick={() => updateStatus(t.id, "started")}
                      >
                        Start
                      </button>
                    )}

                    {t.status === "started" && (
                      <button
                        className="rounded-lg px-3 py-2 text-white"
                        style={{ background: "var(--moovu-primary)" }}
                        onClick={() => updateStatus(t.id, "completed")}
                      >
                        Complete
                      </button>
                    )}

                    {t.status !== "completed" && t.status !== "cancelled" && (
                      <button
                        className="border rounded-lg px-3 py-2 bg-white text-black"
                        onClick={() => updateStatus(t.id, "cancelled")}
                      >
                        Cancel
                      </button>
                    )}

                    <Link
                      href={`/admin/trips/${t.id}`}
                      className="border rounded-lg px-3 py-2 bg-white text-black"
                    >
                      Open
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}