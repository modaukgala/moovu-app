"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type ReceiptTrip = {
  id: string;
  rider_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  status: string | null;
  created_at: string | null;
  completed_at: string | null;
};

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  return new Date(value).toLocaleString();
}

export default function AdminReceiptsPage() {
  const [trips, setTrips] = useState<ReceiptTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadReceipts() {
    setLoading(true);
    setMsg(null);

    const { data, error } = await supabaseClient
      .from("trips")
      .select(
        "id, rider_name, pickup_address, dropoff_address, fare_amount, payment_method, status, created_at, completed_at"
      )
      .in("status", ["completed", "cancelled"])
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      setMsg(error.message);
      setTrips([]);
      setLoading(false);
      return;
    }

    setTrips((data ?? []) as ReceiptTrip[]);
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReceipts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="space-y-5">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="moovu-section-title">Receipts</div>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">
            Trip receipts
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Open printable receipts for completed and cancelled trips.
          </p>
        </div>

        <button type="button" onClick={() => void loadReceipts()} className="moovu-btn moovu-btn-secondary">
          Refresh
        </button>
      </div>

      <section className="moovu-card overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-5">
            <div className="moovu-skeleton h-5 w-44" />
            <div className="moovu-skeleton h-20 w-full" />
            <div className="moovu-skeleton h-20 w-full" />
          </div>
        ) : trips.length === 0 ? (
          <div className="p-5 text-sm text-slate-600">No receipts are available yet.</div>
        ) : (
          <div className="divide-y divide-[var(--moovu-border)]">
            {trips.map((trip) => (
              <div key={trip.id} className="grid gap-4 p-4 md:grid-cols-[1.4fr_1fr_0.7fr_0.7fr_auto] md:items-center">
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-950">{trip.rider_name || "Rider"}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {trip.pickup_address || "--"} to {trip.dropoff_address || "--"}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Issued</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {formatDate(trip.completed_at ?? trip.created_at)}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Fare</div>
                  <div className="mt-1 text-sm font-black text-slate-950">{money(trip.fare_amount)}</div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Status</div>
                  <div className="mt-1 text-sm font-semibold capitalize text-slate-900">
                    {trip.status || "--"}
                  </div>
                </div>

                <Link href={`/admin/receipts/${trip.id}`} className="moovu-btn moovu-btn-primary">
                  Open
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
