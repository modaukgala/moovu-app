"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type Wallet = {
  balance_due: number | null;
  total_commission: number | null;
  total_driver_net: number | null;
  total_trips_completed: number | null;
  last_payment_at: string | null;
  last_payment_amount: number | null;
  account_status: string | null;
};

type Transaction = {
  id: string;
  amount: number | null;
  tx_type: string | null;
  direction: string | null;
  description: string | null;
  created_at: string | null;
};

type Settlement = {
  id: string;
  amount_paid: number;
  payment_method: string;
  reference: string | null;
  note: string | null;
  created_at: string;
};

type CompletedTrip = {
  id: string;
  fare_amount: number | null;
  commission_amount: number | null;
  driver_net_earnings: number | null;
  payment_method: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  created_at: string | null;
  status: string | null;
};

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

export default function DriverEarningsPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [trips, setTrips] = useState<CompletedTrip[]>([]);

  async function getToken() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token || "";
  }

  async function loadData() {
    setLoading(true);
    setMsg(null);

    const token = await getToken();
    if (!token) {
      setMsg("You are not logged in.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/driver/earnings", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load earnings.");
      setLoading(false);
      return;
    }

    setWallet(json.earnings?.wallet ?? null);
    setTransactions(json.earnings?.transactions ?? []);
    setSettlements(json.earnings?.settlements ?? []);
    setTrips(json.earnings?.recent_completed_trips ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return <main className="p-6 text-black">Loading driver earnings...</main>;
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">MOOVU Driver</div>
            <h1 className="text-3xl font-semibold mt-1">Earnings & Wallet</h1>
            <p className="text-gray-700 mt-2">
              Review your commission balance, settlement history and recent completed trips.
            </p>
          </div>

          <Link href="/driver" className="border rounded-xl px-4 py-2 bg-white">
            Back to Dashboard
          </Link>
        </div>

        <section className="grid md:grid-cols-5 gap-4">
          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Balance Due to MOOVU</div>
            <div className="text-2xl font-semibold mt-2">{money(wallet?.balance_due)}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Total Commission</div>
            <div className="text-2xl font-semibold mt-2">{money(wallet?.total_commission)}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Total Driver Net</div>
            <div className="text-2xl font-semibold mt-2">{money(wallet?.total_driver_net)}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Trips Completed</div>
            <div className="text-2xl font-semibold mt-2">{wallet?.total_trips_completed ?? 0}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Last Payment</div>
            <div className="text-lg font-semibold mt-2">
              {wallet?.last_payment_at
                ? `${money(wallet?.last_payment_amount)}`
                : "—"}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {wallet?.last_payment_at ? new Date(wallet.last_payment_at).toLocaleString() : ""}
            </div>
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Settlement History</h2>

          {settlements.length === 0 ? (
            <div>No payments to MOOVU have been recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {settlements.map((row) => (
                <div key={row.id} className="border rounded-2xl p-4">
                  <div className="grid md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Amount Paid</div>
                      <div className="font-medium">{money(row.amount_paid)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Method</div>
                      <div className="font-medium">{row.payment_method}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Reference</div>
                      <div className="font-medium">{row.reference || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Date</div>
                      <div className="font-medium">{new Date(row.created_at).toLocaleString()}</div>
                    </div>
                  </div>

                  {row.note && <div className="text-sm text-gray-700 mt-3">{row.note}</div>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Wallet Transactions</h2>

          {transactions.length === 0 ? (
            <div>No wallet transactions yet.</div>
          ) : (
            <div className="space-y-3">
              {transactions.map((tx) => (
                <div key={tx.id} className="border rounded-2xl p-4">
                  <div className="grid md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Type</div>
                      <div className="font-medium">{tx.tx_type || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Direction</div>
                      <div className="font-medium">{tx.direction || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Amount</div>
                      <div className="font-medium">{money(tx.amount)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Date</div>
                      <div className="font-medium">
                        {tx.created_at ? new Date(tx.created_at).toLocaleString() : "—"}
                      </div>
                    </div>
                  </div>

                  {tx.description && <div className="text-sm text-gray-700 mt-3">{tx.description}</div>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Recent Completed Trips</h2>

          {trips.length === 0 ? (
            <div>No completed trips yet.</div>
          ) : (
            <div className="space-y-3">
              {trips.map((trip) => (
                <div key={trip.id} className="border rounded-2xl p-4">
                  <div className="grid md:grid-cols-5 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Fare</div>
                      <div className="font-medium">{money(trip.fare_amount)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Commission</div>
                      <div className="font-medium">{money(trip.commission_amount)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Your Net</div>
                      <div className="font-medium">{money(trip.driver_net_earnings)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Payment</div>
                      <div className="font-medium">{trip.payment_method || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Date</div>
                      <div className="font-medium">
                        {trip.created_at ? new Date(trip.created_at).toLocaleString() : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4 mt-3">
                    <div>
                      <div className="text-sm text-gray-500">Pickup</div>
                      <div className="font-medium">{trip.pickup_address || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Dropoff</div>
                      <div className="font-medium">{trip.dropoff_address || "—"}</div>
                    </div>
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