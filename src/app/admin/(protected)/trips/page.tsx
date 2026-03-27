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

const STATUSES = [
  "all",
  "requested",
  "assigned",
  "arrived",
  "ongoing",
  "completed",
  "cancelled",
] as const;

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [pageError, setPageError] = useState<string | null>(null);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    return session?.access_token ?? null;
  }

  async function loadDrivers() {
    const { data } = await supabaseClient
      .from("drivers")
      .select("id, first_name, last_name, phone, status")
      .in("status", ["approved", "active"])
      .order("created_at", { ascending: false });

    setDrivers((data as Driver[]) ?? []);
  }

  async function loadTrips(currentStatus: string) {
    setLoading(true);

    let q = supabaseClient
      .from("trips")
      .select("*")
      .order("created_at", { ascending: false });

    if (currentStatus !== "all") {
      q = q.eq("status", currentStatus);
    }

    const { data } = await q;
    setTrips((data as Trip[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadDrivers();
    loadTrips(status);
  }, [status]);

  const driverNameById = useMemo(() => {
    const map = new Map<string, string>();
    drivers.forEach((d) => {
      map.set(d.id, `${d.first_name} ${d.last_name}`);
    });
    return map;
  }, [drivers]);

  async function assignDriver(tripId: string, driverId: string) {
    setActionLoadingId(tripId);
    setPageError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setPageError("You are not logged in.");
        return;
      }

      const res = await fetch("/api/admin/trips/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tripId, driverId }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setPageError(json?.error || "Failed to assign driver.");
        return;
      }

      await loadTrips(status);
    } catch (e: any) {
      setPageError(e?.message || "Failed to assign driver.");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function cancelTrip(tripId: string) {
    setActionLoadingId(tripId);
    setPageError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setPageError("You are not logged in.");
        return;
      }

      const res = await fetch("/api/admin/trips/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tripId,
          reason: "Cancelled by admin from trips list",
        }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setPageError(json?.error || "Failed to cancel trip.");
        return;
      }

      await loadTrips(status);
    } catch (e: any) {
      setPageError(e?.message || "Failed to cancel trip.");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function markArrived(tripId: string) {
    setActionLoadingId(tripId);
    setPageError(null);

    try {
      const { error } = await supabaseClient
        .from("trips")
        .update({ status: "arrived" })
        .eq("id", tripId);

      if (error) {
        setPageError(error.message);
        return;
      }

      await loadTrips(status);
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <main className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Trips</h1>
          <p className="opacity-70 mt-1">Dispatcher console.</p>
        </div>

        <Link className="border rounded-xl px-4 py-2" href="/admin/trips/new">
          + New Trip
        </Link>
      </div>

      {pageError && (
        <div className="border rounded-xl p-3 text-sm text-red-600">
          {pageError}
        </div>
      )}

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
                <Link
                  className="underline underline-offset-4 hover:opacity-80"
                  href={`/admin/trips/${t.id}`}
                >
                  <div className="font-medium">{t.pickup_address}</div>
                  <div className="opacity-70 mt-1">{t.dropoff_address}</div>
                </Link>
              </div>

              <div className="col-span-2 p-3">
                <div className="font-medium">{t.rider_name ?? "—"}</div>
                <div className="opacity-70 mt-1">{t.rider_phone ?? "—"}</div>
              </div>

              <div className="col-span-2 p-3">
                {t.driver_id ? (
                  <div className="font-medium">
                    {driverNameById.get(t.driver_id) ?? t.driver_id}
                  </div>
                ) : (
                  <div className="opacity-70">Unassigned</div>
                )}

                {!t.driver_id && (
                  <select
                    className="mt-2 w-full border rounded-xl p-2 bg-transparent"
                    defaultValue=""
                    disabled={actionLoadingId === t.id}
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

              <div className="col-span-1 p-3">
                {t.fare_amount !== null ? `R${Number(t.fare_amount).toFixed(2)}` : "—"}
              </div>

              <div className="col-span-1 p-3 capitalize">{t.status}</div>

              <div className="col-span-2 p-3 flex flex-wrap gap-2">
                {t.status === "assigned" && (
                  <button
                    className="border rounded-lg px-3 py-1"
                    disabled={actionLoadingId === t.id}
                    onClick={() => markArrived(t.id)}
                  >
                    Arrived
                  </button>
                )}

                {t.status === "arrived" && (
                  <Link
                    className="border rounded-lg px-3 py-1"
                    href={`/admin/trips/${t.id}`}
                  >
                    Verify OTP & Start
                  </Link>
                )}

                {t.status === "ongoing" && (
                  <Link
                    className="border rounded-lg px-3 py-1"
                    href={`/admin/trips/${t.id}`}
                  >
                    Complete
                  </Link>
                )}

                {t.status !== "completed" && t.status !== "cancelled" && (
                  <button
                    className="border rounded-lg px-3 py-1"
                    disabled={actionLoadingId === t.id}
                    onClick={() => cancelTrip(t.id)}
                  >
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