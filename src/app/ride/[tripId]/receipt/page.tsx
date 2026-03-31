"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Trip = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  payment_method: string | null;
  fare_amount: number | null;
  status: string;
  created_at: string | null;
  driver_id: string | null;
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

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildReceiptNumber(tripId: string, createdAt: string | null | undefined) {
  const shortTrip = tripId.slice(0, 8).toUpperCase();
  const datePart = createdAt
    ? new Date(createdAt).toISOString().slice(0, 10).replace(/-/g, "")
    : "00000000";

  return `MV-${datePart}-${shortTrip}`;
}

export default function TripReceiptPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadReceipt() {
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch(`/api/public/trip-status?tripId=${encodeURIComponent(tripId)}`, {
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setMsg(json?.error || "Could not load receipt.");
        setLoading(false);
        return;
      }

      setTrip(json.trip ?? null);
      setDriver(json.driver ?? null);
    } catch (e: any) {
      setMsg(e?.message || "Could not load receipt.");
    }

    setLoading(false);
  }

  useEffect(() => {
    loadReceipt();
  }, [tripId]);

  const totalPaid = Number(trip?.fare_amount ?? 0);

  const vatAmount = useMemo(() => {
    return totalPaid - totalPaid / 1.15;
  }, [totalPaid]);

  const fareExclVat = useMemo(() => {
    return totalPaid / 1.15;
  }, [totalPaid]);

  const receiptNumber = useMemo(() => {
    return buildReceiptNumber(trip?.id ?? "", trip?.created_at);
  }, [trip?.id, trip?.created_at]);

  const vehicleLabel = useMemo(() => {
    if (!driver) return "—";
    const value = [driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(" ");
    return value || "—";
  }, [driver]);

  if (loading) {
    return <main className="p-6 text-black">Loading receipt...</main>;
  }

  if (!trip) {
    return <main className="p-6 text-black">{msg || "Receipt not found."}</main>;
  }

  return (
    <main className="min-h-screen bg-[#eaf2ff] px-4 py-6 text-black">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3 print:hidden">
          <Link
            href={`/ride-confirm/${trip.id}`}
            className="inline-flex items-center rounded-xl border px-4 py-2 bg-white"
          >
            ← Back to Trip
          </Link>

          <button
            onClick={() => window.print()}
            className="rounded-xl px-4 py-2 text-white"
            style={{ background: "var(--moovu-primary)" }}
          >
            Print Receipt
          </button>
        </div>

        {msg && (
          <div className="rounded-xl border bg-white p-4 text-sm print:hidden">
            {msg}
          </div>
        )}

        <section className="mx-auto max-w-4xl rounded-[2rem] border bg-white px-6 py-8 shadow-sm print:shadow-none print:border-black">
          <div className="text-center">
            <h1 className="text-4xl font-bold">MOOVU Kasi Rides</h1>
            <div className="mt-2 text-2xl font-semibold">Digital Receipt</div>
            <div className="mt-3 text-xl text-gray-600">{receiptNumber}</div>
          </div>

          <div className="my-8 border-t border-dashed border-black" />

          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-5">
              <div>
                <div className="text-gray-500">Trip ID</div>
                <div className="mt-1 break-all text-xl">{trip.id}</div>
              </div>

              <div>
                <div className="text-gray-500">Date & Time</div>
                <div className="mt-1 text-xl">{formatDateTime(trip.created_at)}</div>
              </div>

              <div>
                <div className="text-gray-500">Payment Method</div>
                <div className="mt-1 text-xl capitalize">{trip.payment_method ?? "—"}</div>
              </div>

              <div>
                <div className="text-gray-500">Trip Status</div>
                <div className="mt-1 text-xl capitalize">{trip.status}</div>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <div className="text-gray-500">Rider</div>
                <div className="mt-1 text-xl">{trip.rider_name ?? "—"}</div>
              </div>

              <div>
                <div className="text-gray-500">Rider Phone</div>
                <div className="mt-1 text-xl">{trip.rider_phone ?? "—"}</div>
              </div>

              <div>
                <div className="text-gray-500">Driver</div>
                <div className="mt-1 text-xl">
                  {driver ? `${driver.first_name ?? "—"} ${driver.last_name ?? ""}` : "—"}
                </div>
              </div>

              <div>
                <div className="text-gray-500">Driver Phone</div>
                <div className="mt-1 text-xl">{driver?.phone ?? "—"}</div>
              </div>
            </div>
          </div>

          <div className="my-8 border-t border-dashed border-black" />

          <div className="space-y-5">
            <div>
              <div className="text-gray-500">Pickup</div>
              <div className="mt-1 text-xl">{trip.pickup_address ?? "—"}</div>
            </div>

            <div>
              <div className="text-gray-500">Dropoff</div>
              <div className="mt-1 text-xl">{trip.dropoff_address ?? "—"}</div>
            </div>
          </div>

          <div className="my-8 border-t border-dashed border-black" />

          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-5">
              <div>
                <div className="text-gray-500">Vehicle</div>
                <div className="mt-1 text-xl">{vehicleLabel}</div>
              </div>

              <div>
                <div className="text-gray-500">Registration</div>
                <div className="mt-1 text-xl">{driver?.vehicle_registration ?? "—"}</div>
              </div>

              <div>
                <div className="text-gray-500">Vehicle Details</div>
                <div className="mt-1 text-xl">
                  {[driver?.vehicle_year, driver?.vehicle_color].filter(Boolean).join(" • ") || "—"}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 text-xl">
                <span className="text-gray-600">Trip Fare excl. VAT</span>
                <span>{money(fareExclVat)}</span>
              </div>

              <div className="flex items-center justify-between gap-4 text-xl">
                <span className="text-gray-600">VAT 15%</span>
                <span>{money(vatAmount)}</span>
              </div>

              <div className="border-t border-black pt-4">
                <div className="flex items-center justify-between gap-4 text-3xl font-bold">
                  <span>Total Paid</span>
                  <span>{money(totalPaid)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="my-8 border-t border-dashed border-black" />

          <div className="text-center">
            <div className="text-3xl font-bold">Thank you for riding with MOOVU</div>
            <div className="mt-4 text-xl text-gray-600">
              This amount already includes VAT. The rider still pays the full fare calculated by the app.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}