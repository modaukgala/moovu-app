"use client";

import { useEffect, useMemo, useState } from "react";
import { waLinkZA } from "@/lib/whatsapp";

type BoardTrip = {
  id: string;
  driver_id: string | null;
  pickup_address: string;
  dropoff_address: string;
  fare_amount: number | null;
  payment_method: string | null;
  status: string;
  cancel_reason: string | null;
  created_at: string;
  offer_status: string | null;
  offer_expires_at: string | null;
  offer_attempted_driver_ids: string[] | null;
  attempted_count: number;
  driver: {
    id: string;
    name: string;
    phone: string | null;
    online: boolean | null;
    busy: boolean | null;
    subscription_status: string | null;
  } | null;
};

function groupKey(status: string) {
  if (status === "requested") return "requested";
  if (status === "offered") return "offered";
  if (status === "assigned" || status === "arrived" || status === "started") return "active";
  return "closed";
}

export default function DispatchBoardPage() {
  const [rows, setRows] = useState<BoardTrip[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, setTick] = useState(0);

  async function loadBoard() {
    const res = await fetch("/api/admin/dispatch/board");
    const json = await res.json();

    if (!json.ok) {
      setMsg(json.error || "Failed to load dispatch board");
      setRows([]);
      return;
    }

    setMsg(null);
    setRows(json.rows ?? []);
  }

  useEffect(() => {
    loadBoard();
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setTick((x) => x + 1);
      loadBoard();
    }, 3000);
    return () => clearInterval(t);
  }, []);

  async function offerNext(tripId: string) {
    setBusyId(tripId);
    setMsg(null);

    const res = await fetch("/api/admin/trips/auto-assign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tripId }),
    });

    const json = await res.json();
    setBusyId(null);

    if (!json.ok) {
      setMsg(json.error || "Failed to offer next driver");
      return;
    }

    await loadBoard();
  }

  async function openWhatsAppOffer(trip: BoardTrip) {
    if (!trip.driver?.phone) {
      setMsg("Driver phone missing");
      return;
    }

    const expires = trip.offer_expires_at
      ? new Date(trip.offer_expires_at).toLocaleTimeString()
      : null;

    const message =
      `MOOVU TRIP OFFER\n` +
      `Hi ${trip.driver.name}, you have a trip offer.\n\n` +
      `Trip ID: ${trip.id}\n` +
      `Pickup: ${trip.pickup_address}\n` +
      `Dropoff: ${trip.dropoff_address}\n` +
      `Fare: R${trip.fare_amount ?? "—"}\n` +
      `Status: ${trip.status} (${trip.offer_status ?? "—"})\n` +
      (expires ? `Expires at: ${expires}\n` : "") +
      `\nLogin to accept/reject:\nhttps://moovurides.co.za/driver/login`;

    const href = waLinkZA(trip.driver.phone, message);
    if (!href) {
      setMsg("Invalid WhatsApp number");
      return;
    }

    window.open(href, "_blank", "noopener,noreferrer");
  }

  const grouped = useMemo(() => {
    const g = {
      requested: [] as BoardTrip[],
      offered: [] as BoardTrip[],
      active: [] as BoardTrip[],
      closed: [] as BoardTrip[],
    };

    for (const row of rows) {
      g[groupKey(row.status) as keyof typeof g].push(row);
    }

    return g;
  }, [rows]);

  function secondsLeft(expiresAt: string | null) {
    if (!expiresAt) return null;
    return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
  }

  function Column({
    title,
    items,
  }: {
    title: string;
    items: BoardTrip[];
  }) {
    return (
      <section className="border rounded-2xl p-4 min-h-[240px]">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{title}</h2>
          <span className="text-xs opacity-60">{items.length}</span>
        </div>

        <div className="mt-4 space-y-3">
          {items.length === 0 ? (
            <div className="text-sm opacity-60">No trips</div>
          ) : (
            items.map((trip) => {
              const left = secondsLeft(trip.offer_expires_at);

              return (
                <div key={trip.id} className="border rounded-2xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium">Trip {trip.id.slice(0, 8)}</div>
                    <div className="text-xs opacity-60">
                      {new Date(trip.created_at).toLocaleString()}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs opacity-60">Pickup</div>
                    <div className="text-sm">{trip.pickup_address}</div>
                  </div>

                  <div>
                    <div className="text-xs opacity-60">Dropoff</div>
                    <div className="text-sm">{trip.dropoff_address}</div>
                  </div>

                  <div className="text-xs opacity-70">
                    Fare: <span className="font-medium">R{trip.fare_amount ?? "—"}</span>
                    {" • "}
                    Payment: <span className="font-medium">{trip.payment_method ?? "—"}</span>
                  </div>

                  <div className="text-xs opacity-70">
                    Status: <span className="font-medium">{trip.status}</span>
                    {trip.offer_status ? (
                      <>
                        {" • "}Offer: <span className="font-medium">{trip.offer_status}</span>
                      </>
                    ) : null}
                    {left != null ? (
                      <>
                        {" • "}Left: <span className="font-medium">{left}s</span>
                      </>
                    ) : null}
                  </div>

                  <div className="text-xs opacity-70">
                    Attempted drivers: <span className="font-medium">{trip.attempted_count}</span>
                  </div>

                  <div className="text-xs opacity-70">
                    Driver:{" "}
                    <span className="font-medium">
                      {trip.driver
                        ? `${trip.driver.name}${trip.driver.phone ? ` (${trip.driver.phone})` : ""}`
                        : "Unassigned"}
                    </span>
                  </div>

                  {trip.driver && (
                    <div className="text-xs opacity-70">
                      Driver ops:{" "}
                      <span className="font-medium">
                        {trip.driver.online ? "online" : "offline"} •{" "}
                        {trip.driver.busy ? "busy" : "free"} •{" "}
                        {trip.driver.subscription_status ?? "no-sub"}
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {(trip.status === "requested" || trip.status === "offered") && (
                      <button
                        className="border rounded-xl px-3 py-2 text-sm"
                        disabled={busyId === trip.id}
                        onClick={() => offerNext(trip.id)}
                      >
                        {busyId === trip.id ? "Working..." : "Offer next driver"}
                      </button>
                    )}

                    {trip.driver && (trip.status === "offered" || trip.status === "assigned") && (
                      <button
                        className="border rounded-xl px-3 py-2 text-sm"
                        onClick={() => openWhatsAppOffer(trip)}
                      >
                        WhatsApp driver
                      </button>
                    )}

                    <a
                      className="border rounded-xl px-3 py-2 text-sm"
                      href={`/admin/trips/${trip.id}`}
                    >
                      Open trip
                    </a>
                  </div>

                  {trip.cancel_reason && (
                    <div className="text-xs opacity-70">
                      Cancel reason: <span className="font-medium">{trip.cancel_reason}</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    );
  }

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dispatch Board</h1>
          <p className="opacity-70 mt-1">
            Live operational queue for requested, offered, active, and closed trips.
          </p>
        </div>

        <button className="border rounded-xl px-4 py-2" onClick={loadBoard}>
          Refresh
        </button>
      </div>

      {msg && <div className="border rounded-2xl p-4 text-sm">{msg}</div>}

      <div className="grid xl:grid-cols-4 md:grid-cols-2 gap-4">
        <Column title="Requested" items={grouped.requested} />
        <Column title="Offered" items={grouped.offered} />
        <Column title="Active" items={grouped.active} />
        <Column title="Closed" items={grouped.closed} />
      </div>
    </main>
  );
}