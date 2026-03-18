"use client";

import { useEffect, useMemo, useState } from "react";

type Trip = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  status: string | null;
  driver_id: string | null;
  created_at: string | null;
};

type DriverOpt = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string | null;
  online: boolean | null;
  busy: boolean | null;
};

export default function AdminTripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<DriverOpt[]>([]);
  const [busyTripId, setBusyTripId] = useState<string | null>(null);
  const [driverSelections, setDriverSelections] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  async function loadTrips() {
    setMsg(null);

    const res = await fetch("/api/admin/trips/list", { cache: "no-store" });
    const contentType = res.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      setMsg("Trips list route is not returning JSON.");
      return;
    }

    const json = await res.json();

    if (!json.ok) {
      setMsg(json.error || "Failed to load trips.");
      return;
    }

    setTrips(json.trips ?? []);
  }

  async function loadDrivers() {
    const res = await fetch("/api/admin/drivers/options", { cache: "no-store" });
    const contentType = res.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      setMsg("Drivers options route is not returning JSON.");
      return;
    }

    const json = await res.json();

    if (!json.ok) {
      setMsg(json.error || "Failed to load drivers.");
      return;
    }

    setDrivers(json.drivers ?? []);
  }

  async function assignDriver(tripId: string) {
    const driverId = driverSelections[tripId];

    if (!driverId) {
      setMsg("Please select a driver first.");
      return;
    }

    setBusyTripId(tripId);
    setMsg(null);

    try {
      const res = await fetch("/api/admin/trips/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tripId,
          driverId,
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setMsg("Assign route is not returning JSON.");
        setBusyTripId(null);
        return;
      }

      const json = await res.json();

      if (!json.ok) {
        setMsg(json.error || "Failed to assign driver.");
        setBusyTripId(null);
        return;
      }

      setMsg(`✅ ${json.message}`);
      setBusyTripId(null);
      await loadTrips();
      await loadDrivers();
    } catch (e: any) {
      setMsg(e?.message || "Failed to assign driver.");
      setBusyTripId(null);
    }
  }

  useEffect(() => {
    loadTrips();
    loadDrivers();
  }, []);

  const requestedTrips = useMemo(
    () => trips.filter((t) => t.status === "requested" || t.status === "pending" || t.status === "searching"),
    [trips]
  );

  const activeTrips = useMemo(
    () => trips.filter((t) => t.status && !["requested", "pending", "searching", "completed", "cancelled"].includes(t.status)),
    [trips]
  );

  const finishedTrips = useMemo(
    () => trips.filter((t) => t.status === "completed" || t.status === "cancelled"),
    [trips]
  );

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">MOOVU Admin</div>
          <h1 className="text-3xl font-semibold mt-1">Trips Control Center</h1>
          <p className="text-gray-700 mt-2">
            View new trips and manually assign available drivers.
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

        <div className="flex gap-2">
          <button className="border rounded-xl px-4 py-2 bg-white" onClick={loadTrips}>
            Refresh Trips
          </button>
          <button className="border rounded-xl px-4 py-2 bg-white" onClick={loadDrivers}>
            Refresh Drivers
          </button>
        </div>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">New / Unassigned Trips</h2>

          {requestedTrips.length === 0 ? (
            <p className="text-gray-700">No unassigned trips.</p>
          ) : (
            <div className="space-y-4">
              {requestedTrips.map((trip) => (
                <div key={trip.id} className="border rounded-2xl p-4 space-y-4">
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

                  <div className="grid md:grid-cols-5 gap-4">
                    <div>
                      <div className="text-sm text-gray-600">Rider</div>
                      <div className="font-medium">{trip.rider_name ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Phone</div>
                      <div className="font-medium">{trip.rider_phone ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Fare</div>
                      <div className="font-medium">R{trip.fare_amount ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Payment</div>
                      <div className="font-medium">{trip.payment_method ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Status</div>
                      <div className="font-medium">{trip.status ?? "—"}</div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
                    <div>
                      <label className="block text-sm text-gray-600 mb-2">Assign Driver</label>
                      <select
                        className="w-full border rounded-xl p-3 bg-white"
                        value={driverSelections[trip.id] ?? ""}
                        onChange={(e) =>
                          setDriverSelections((prev) => ({
                            ...prev,
                            [trip.id]: e.target.value,
                          }))
                        }
                      >
                        <option value="">Select driver...</option>
                        {drivers.map((d) => {
                          const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";
                          return (
                            <option key={d.id} value={d.id}>
                              {name} • {d.phone ?? "—"} • {d.online ? "Online" : "Offline"} • {d.busy ? "Busy" : "Free"}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <button
                      className="rounded-xl px-4 py-3 text-white"
                      style={{ background: "var(--moovu-primary)" }}
                      disabled={busyTripId === trip.id}
                      onClick={() => assignDriver(trip.id)}
                    >
                      {busyTripId === trip.id ? "Assigning..." : "Assign Driver"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Active Trips</h2>

          {activeTrips.length === 0 ? (
            <p className="text-gray-700">No active trips.</p>
          ) : (
            <div className="space-y-3">
              {activeTrips.map((trip) => (
                <div key={trip.id} className="border rounded-2xl p-4">
                  <div className="font-medium">
                    {trip.pickup_address ?? "—"} → {trip.dropoff_address ?? "—"}
                  </div>
                  <div className="text-sm text-gray-700 mt-1">
                    Status: {trip.status ?? "—"} • Fare: R{trip.fare_amount ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Completed / Cancelled Trips</h2>

          {finishedTrips.length === 0 ? (
            <p className="text-gray-700">No completed or cancelled trips.</p>
          ) : (
            <div className="space-y-3">
              {finishedTrips.map((trip) => (
                <div key={trip.id} className="border rounded-2xl p-4">
                  <div className="font-medium">
                    {trip.pickup_address ?? "—"} → {trip.dropoff_address ?? "—"}
                  </div>
                  <div className="text-sm text-gray-700 mt-1">
                    Status: {trip.status ?? "—"} • Fare: R{trip.fare_amount ?? "—"}
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