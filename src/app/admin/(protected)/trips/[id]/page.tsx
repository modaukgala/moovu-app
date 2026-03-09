"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import { waLinkZA } from "@/lib/whatsapp";

type Trip = {
  id: string;
  driver_id: string | null;
  pickup_address: string;
  dropoff_address: string;
  payment_method: string;
  fare_amount: number | null;
  status: string;
  cancel_reason: string | null;
  created_at: string;

  offer_status: string | null;
  offer_expires_at: string | null;
};

type TripEvent = {
  id: string;
  event_type: string;
  message: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
};

type Driver = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  online: boolean | null;
  busy: boolean | null;
  status: string;
};

export default function TripDetailPage() {
  const params = useParams<{ id: string }>();
  const tripId = params.id;
  const router = useRouter();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [events, setEvents] = useState<TripEvent[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);

  const [tick, setTick] = useState(0);
  const [waBusy, setWaBusy] = useState(false);

  async function loadAll() {
    setLoading(true);

    const { data: t } = await supabaseClient.from("trips").select("*").eq("id", tripId).single();
    const { data: ev } = await supabaseClient
      .from("trip_events")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });

    const { data: dr } = await supabaseClient
      .from("drivers")
      .select("id, first_name, last_name, phone, status, online, busy")
      .in("status", ["approved", "active"])
      .order("created_at", { ascending: false });

    setTrip((t as any) ?? null);
    setEvents((ev as any) ?? []);
    setDrivers((dr as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // live countdown refresh
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const driverLabel = useMemo(() => {
    if (!trip?.driver_id) return "Unassigned";
    const d = drivers.find((x) => x.id === trip.driver_id);
    return d ? `${d.first_name} ${d.last_name} (${d.phone})` : trip.driver_id;
  }, [drivers, trip?.driver_id]);

  const offerSecondsLeft = useMemo(() => {
    if (!trip?.offer_expires_at) return null;
    const left = Math.ceil((new Date(trip.offer_expires_at).getTime() - Date.now()) / 1000);
    return left;
  }, [trip?.offer_expires_at, tick]);

  async function offerNearest(exclude: string[] = []) {
    if (!trip) return;

    const res = await fetch("/api/admin/trips/auto-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId: trip.id, excludeDriverIds: exclude }),
    });

    const json = await res.json();
    if (!json.ok) {
      alert(json.error || "Offer failed");
      return;
    }
    await loadAll();
  }

  async function openWhatsAppOffer() {
    if (!trip?.id) return;

    setWaBusy(true);
    try {
      const res = await fetch(`/api/admin/trips/wa-offer?tripId=${encodeURIComponent(trip.id)}`);
      const json = await res.json();

      if (!json.ok) {
        alert(json.error || "Unable to prepare WhatsApp offer");
        return;
      }

      const d = json.driver;
      const t = json.trip;

      const driverName = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Driver";
      const expires = t.offer_expires_at ? new Date(t.offer_expires_at).toLocaleTimeString() : null;
      const secondsLeftLocal =
        t.offer_expires_at ? Math.max(0, Math.ceil((new Date(t.offer_expires_at).getTime() - Date.now()) / 1000)) : null;

      const message =
        `MOOVU TRIP OFFER\n` +
        `Hi ${driverName}, you have a new trip offer.\n\n` +
        `Trip ID: ${t.id}\n` +
        `Pickup: ${t.pickup_address}\n` +
        `Dropoff: ${t.dropoff_address}\n` +
        `Fare: R${t.fare_amount ?? "—"}\n` +
        `Status: ${t.status} (${t.offer_status ?? "—"})\n` +
        (expires ? `Expires at: ${expires} (${secondsLeftLocal ?? "—"}s)\n` : "") +
        `\nTo accept/reject: https://moovurides.co.za/driver\n` +
        `Login: https://moovurides.co.za/driver/login`;

      const href = waLinkZA(d.phone, message);
      if (!href) {
        alert("Driver phone is missing/invalid for WhatsApp.");
        return;
      }

      window.open(href, "_blank", "noopener,noreferrer");
    } finally {
      setWaBusy(false);
    }
  }

  async function cancelTrip() {
    if (!trip) return;
    const reason = prompt("Cancel reason?")?.trim();
    if (!reason) return;

    await supabaseClient.from("trips").update({ status: "cancelled", cancel_reason: reason }).eq("id", tripId);
    await supabaseClient.from("trip_events").insert({
      trip_id: tripId,
      event_type: "cancel",
      message: `Cancelled: ${reason}`,
      old_status: trip.status,
      new_status: "cancelled",
    });

    // free driver if any
    if (trip.driver_id) {
      await supabaseClient.from("drivers").update({ busy: false }).eq("id", trip.driver_id);
    }

    await loadAll();
  }

  async function markCompleted() {
    if (!trip) return;

    await supabaseClient.from("trips").update({ status: "completed" }).eq("id", tripId);
    await supabaseClient.from("trip_events").insert({
      trip_id: tripId,
      event_type: "status_change",
      message: "Completed",
      old_status: trip.status,
      new_status: "completed",
    });

    if (trip.driver_id) {
      await supabaseClient.from("drivers").update({ busy: false }).eq("id", trip.driver_id);
    }

    await loadAll();
  }

  if (loading) return <main className="p-6">Loading trip...</main>;
  if (!trip) {
    return (
      <main className="p-6">
        <p>Trip not found.</p>
        <button className="border rounded-xl px-4 py-2 mt-3" onClick={() => router.push("/admin/trips")}>
          Back
        </button>
      </main>
    );
  }

  const isClosed = trip.status === "completed" || trip.status === "cancelled";

  const canWhatsApp = !!trip.driver_id && (trip.offer_status === "pending" || trip.status === "assigned");

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Trip</h1>
          <p className="opacity-70 mt-1">
            Status: <span className="capitalize">{trip.status}</span>
            {trip.cancel_reason ? ` • Reason: ${trip.cancel_reason}` : ""}
          </p>
        </div>

        <button className="border rounded-xl px-4 py-2" onClick={() => router.push("/admin/trips")}>
          Back to Trips
        </button>
      </div>

      <section className="border rounded-2xl p-5 space-y-3">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm opacity-70">Pickup</div>
            <div className="font-medium">{trip.pickup_address}</div>
          </div>
          <div>
            <div className="text-sm opacity-70">Dropoff</div>
            <div className="font-medium">{trip.dropoff_address}</div>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-4 pt-2">
          <div>
            <div className="text-sm opacity-70">Driver</div>
            <div className="font-medium">{driverLabel}</div>
            {trip.offer_status === "pending" && offerSecondsLeft != null && (
              <div className="text-sm opacity-70 mt-1">Offer pending • {Math.max(0, offerSecondsLeft)}s left</div>
            )}
          </div>

          <div>
            <div className="text-sm opacity-70">Payment</div>
            <div className="font-medium capitalize">{trip.payment_method}</div>
          </div>

          <div>
            <div className="text-sm opacity-70">Fare</div>
            <div className="font-medium">{trip.fare_amount ?? "—"}</div>
          </div>

          <div>
            <div className="text-sm opacity-70">Offer</div>
            <div className="font-medium">{trip.offer_status ?? "—"}</div>
          </div>
        </div>
      </section>

      <section className="border rounded-2xl p-5">
        <h2 className="font-semibold">Actions</h2>

        <div className="flex flex-wrap gap-2 mt-4">
          {!isClosed && trip.offer_status !== "pending" && trip.status !== "assigned" && (
            <button className="border rounded-xl px-4 py-2" onClick={() => offerNearest([])}>
              Offer nearest driver
            </button>
          )}

          {!isClosed && trip.offer_status === "pending" && (
            <button className="border rounded-xl px-4 py-2" onClick={() => loadAll()}>
              Refresh
            </button>
          )}

          {!isClosed && canWhatsApp && (
            <button className="border rounded-xl px-4 py-2" disabled={waBusy} onClick={openWhatsAppOffer}>
              {waBusy ? "Preparing..." : "WhatsApp driver"}
            </button>
          )}

          {!isClosed && (
            <button className="border rounded-xl px-4 py-2" onClick={cancelTrip}>
              Cancel
            </button>
          )}

          {!isClosed && trip.status === "assigned" && (
            <button className="border rounded-xl px-4 py-2" onClick={markCompleted}>
              Mark Completed
            </button>
          )}
        </div>

        <p className="text-xs opacity-60 mt-3">
          Note: If an offer expires, it will be cleaned up when the driver/admin polls again. Then you can offer the next
          driver.
        </p>
      </section>

      <section className="border rounded-2xl p-5">
        <h2 className="font-semibold">Timeline</h2>

        {events.length === 0 ? (
          <p className="opacity-70 mt-3">No events yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {events.map((e) => (
              <div key={e.id} className="border rounded-xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{e.event_type}</div>
                  <div className="text-xs opacity-60">{new Date(e.created_at).toLocaleString()}</div>
                </div>
                {e.message && <div className="opacity-80 mt-2">{e.message}</div>}
                {(e.old_status || e.new_status) && (
                  <div className="text-sm opacity-70 mt-2">
                    {e.old_status ?? "—"} → {e.new_status ?? "—"}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}