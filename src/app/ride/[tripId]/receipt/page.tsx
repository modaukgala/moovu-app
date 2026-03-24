"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Receipt = {
  receipt_number: string;
  trip_id: string;
  issued_at: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  payment_method: string | null;
  status: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_registration: string | null;
  subtotal: number;
  vat: number;
  total: number;
  vat_rate: number;
};

function money(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `R${n.toFixed(2)}`;
}

export default function TripReceiptPage() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadReceipt() {
    try {
      const res = await fetch(
        `/api/public/trip-receipt?tripId=${encodeURIComponent(tripId)}`,
        { cache: "no-store" }
      );

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setMsg("Receipt route is not returning JSON.");
        setLoading(false);
        return;
      }

      const json = await res.json();

      if (!json?.ok) {
        setMsg(json?.error || "Failed to load receipt.");
        setLoading(false);
        return;
      }

      setReceipt(json.receipt ?? null);
      setMsg(null);
      setLoading(false);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load receipt.");
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReceipt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const carText = useMemo(() => {
    if (!receipt) return "—";
    return [receipt.vehicle_color, receipt.vehicle_make, receipt.vehicle_model]
      .filter(Boolean)
      .join(" ") || "—";
  }, [receipt]);

  if (loading) {
    return (
      <main className="min-h-screen px-6 py-10 text-black">
        <div className="max-w-3xl mx-auto border rounded-[2rem] p-6 bg-white shadow-sm">
          Loading receipt...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/ride/${tripId}`}
            className="border rounded-xl px-4 py-2 bg-white"
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

        {msg ? (
          <div
            className="border rounded-2xl p-4 text-sm"
            style={{ background: "var(--moovu-primary-soft)" }}
          >
            {msg}
          </div>
        ) : !receipt ? (
          <div className="border rounded-[2rem] p-6 bg-white shadow-sm">
            Receipt not found.
          </div>
        ) : (
          <section className="border rounded-[2rem] p-8 bg-white shadow-sm space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-4xl font-bold">MOOVU Kasi Rides</h1>
              <div className="text-xl font-semibold">Digital Receipt</div>
              <div className="text-gray-700">{receipt.receipt_number}</div>
            </div>

            <div className="border-t border-dashed" />

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-gray-600">Trip ID</div>
                  <div className="font-medium break-all">{receipt.trip_id}</div>
                </div>

                <div>
                  <div className="text-sm text-gray-600">Date & Time</div>
                  <div className="font-medium">
                    {receipt.issued_at
                      ? new Date(receipt.issued_at).toLocaleString()
                      : "—"}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-gray-600">Payment Method</div>
                  <div className="font-medium capitalize">
                    {receipt.payment_method ?? "—"}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-gray-600">Trip Status</div>
                  <div className="font-medium capitalize">{receipt.status ?? "—"}</div>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="text-sm text-gray-600">Rider</div>
                  <div className="font-medium">{receipt.rider_name ?? "—"}</div>
                </div>

                <div>
                  <div className="text-sm text-gray-600">Rider Phone</div>
                  <div className="font-medium">{receipt.rider_phone ?? "—"}</div>
                </div>

                <div>
                  <div className="text-sm text-gray-600">Driver</div>
                  <div className="font-medium">{receipt.driver_name ?? "—"}</div>
                </div>

                <div>
                  <div className="text-sm text-gray-600">Driver Phone</div>
                  <div className="font-medium">{receipt.driver_phone ?? "—"}</div>
                </div>
              </div>
            </div>

            <div className="border-t border-dashed" />

            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-600">Pickup</div>
                <div className="font-medium">{receipt.pickup_address ?? "—"}</div>
              </div>

              <div>
                <div className="text-sm text-gray-600">Dropoff</div>
                <div className="font-medium">{receipt.dropoff_address ?? "—"}</div>
              </div>
            </div>

            <div className="border-t border-dashed" />

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-gray-600">Vehicle</div>
                  <div className="font-medium">{carText}</div>
                </div>

                <div>
                  <div className="text-sm text-gray-600">Registration</div>
                  <div className="font-medium">
                    {receipt.vehicle_registration ?? "—"}
                  </div>
                </div>
              </div>

              <div className="space-y-3 text-right">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-gray-700">Trip Fare excl. VAT</span>
                  <span className="font-medium">{money(receipt.subtotal)}</span>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-gray-700">VAT {receipt.vat_rate}%</span>
                  <span className="font-medium">{money(receipt.vat)}</span>
                </div>

                <div className="border-t pt-3 flex items-center justify-between gap-4 text-xl font-bold">
                  <span>Total Paid</span>
                  <span>{money(receipt.total)}</span>
                </div>
              </div>
            </div>

            <div className="border-t border-dashed" />

            <div className="text-center space-y-2">
              <div className="text-lg font-semibold">
                Thank you for riding with MOOVU
              </div>
              <div className="text-gray-600">
                This amount already includes VAT. The rider still pays the full fare
                calculated by the app.
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}