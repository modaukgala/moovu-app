"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";

type DriverProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email?: string | null;
  status: string | null;
  online: boolean | null;
  busy: boolean | null;
  profile_completed: boolean | null;
  verification_status: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  vehicle_color?: string | null;
  vehicle_registration?: string | null;
  vehicle_vin?: string | null;
  vehicle_engine_number?: string | null;
  seating_capacity?: number | null;
  subscription_status?: string | null;
  subscription_plan?: string | null;
  subscription_expires_at?: string | null;
  created_at?: string | null;
  driver_profile?: {
    home_address?: string | null;
    area_name?: string | null;
    id_number?: string | null;
    alt_phone?: string | null;
    emergency_contact_name?: string | null;
    emergency_contact_phone?: string | null;
    license_number?: string | null;
    license_code?: string | null;
    license_expiry?: string | null;
    pdp_number?: string | null;
    pdp_expiry?: string | null;
  } | null;
};

type Wallet = {
  driver_id: string;
  balance_due: number;
  total_commission: number;
  total_driver_net: number;
  total_trips_completed: number;
  updated_at: string | null;
};

type WalletTxn = {
  id: string;
  trip_id: string | null;
  tx_type: string;
  amount: number;
  note: string | null;
  created_at: string | null;
};

function money(v: number | null | undefined) {
  return `R${Number(v ?? 0).toFixed(2)}`;
}

export default function AdminDriverProfilePage() {
  const params = useParams<{ id: string }>();
  const driverId = params.id;

  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTxn[]>([]);
  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }

  async function loadAll() {
    setBusy(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      setMsg("Missing access token.");
      return;
    }

    const [profileRes, walletRes] = await Promise.all([
      fetch(`/api/admin/driver-profile?driverId=${encodeURIComponent(driverId)}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      fetch(`/api/admin/driver-wallet-summary?driverId=${encodeURIComponent(driverId)}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
    ]);

    const profileJson = await profileRes.json().catch(() => null);
    const walletJson = await walletRes.json().catch(() => null);

    if (!profileJson?.ok) {
      setBusy(false);
      setMsg(profileJson?.error || "Failed to load driver profile.");
      return;
    }

    if (!walletJson?.ok) {
      setBusy(false);
      setMsg(walletJson?.error || "Failed to load wallet summary.");
      return;
    }

    setProfile(profileJson.profile ?? null);
    setWallet(walletJson.wallet ?? null);
    setTransactions(walletJson.transactions ?? []);
    setBusy(false);
  }

  useEffect(() => {
    loadAll();
  }, [driverId]);

  const driverName = useMemo(() => {
    return `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "Unnamed Driver";
  }, [profile]);

  if (busy) {
    return (
      <main className="min-h-screen px-6 py-10 text-black">
        <div className="max-w-6xl mx-auto border rounded-[2rem] p-6 bg-white shadow-sm">
          Loading driver profile...
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-screen px-6 py-10 text-black">
        <div className="max-w-6xl mx-auto space-y-4">
          {msg && <div className="border rounded-2xl p-4 bg-white">{msg}</div>}
          <Link href="/admin/applications" className="inline-flex border rounded-xl px-4 py-2 bg-white">
            Back
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-gray-500">Admin Driver Profile</div>
            <h1 className="text-4xl font-semibold mt-1">{driverName}</h1>
            <p className="text-gray-700 mt-2">
              {profile.phone ?? "—"} • {profile.status ?? "—"} • verification: {profile.verification_status ?? "—"}
            </p>
          </div>

          <Link href="/admin/applications" className="inline-flex border rounded-xl px-4 py-2 bg-white">
            Back
          </Link>
        </div>

        {msg && <div className="border rounded-2xl p-4 bg-white">{msg}</div>}

        <section className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Driver Owes MOOVU</div>
            <div className="text-3xl font-semibold mt-2">{money(wallet?.balance_due)}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Total Commission</div>
            <div className="text-3xl font-semibold mt-2">{money(wallet?.total_commission)}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Driver Net Earnings</div>
            <div className="text-3xl font-semibold mt-2">{money(wallet?.total_driver_net)}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Completed Trips</div>
            <div className="text-3xl font-semibold mt-2">{wallet?.total_trips_completed ?? 0}</div>
          </div>
        </section>

        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-6">
          <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-5">
            <h2 className="text-2xl font-semibold">Driver Details</h2>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-500">Phone</div>
                <div className="text-lg mt-1">{profile.phone ?? "—"}</div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Email</div>
                <div className="text-lg mt-1">{profile.email ?? "—"}</div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Online</div>
                <div className="text-lg mt-1">{profile.online ? "Yes" : "No"}</div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Busy</div>
                <div className="text-lg mt-1">{profile.busy ? "Yes" : "No"}</div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Subscription</div>
                <div className="text-lg mt-1">{profile.subscription_status ?? "—"}</div>
              </div>

              <div>
                <div className="text-sm text-gray-500">Plan</div>
                <div className="text-lg mt-1">{profile.subscription_plan ?? "—"}</div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-xl font-semibold">Vehicle</h3>
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div>
                  <div className="text-sm text-gray-500">Vehicle</div>
                  <div className="text-lg mt-1">
                    {[profile.vehicle_make, profile.vehicle_model].filter(Boolean).join(" ") || "—"}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-gray-500">Registration</div>
                  <div className="text-lg mt-1">{profile.vehicle_registration ?? "—"}</div>
                </div>

                <div>
                  <div className="text-sm text-gray-500">Vehicle Details</div>
                  <div className="text-lg mt-1">
                    {[profile.vehicle_year, profile.vehicle_color].filter(Boolean).join(" • ") || "—"}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-gray-500">Seating Capacity</div>
                  <div className="text-lg mt-1">{profile.seating_capacity ?? "—"}</div>
                </div>
              </div>
            </div>
          </section>

          <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-5">
            <h2 className="text-2xl font-semibold">Recent Wallet Transactions</h2>

            {transactions.length === 0 ? (
              <div className="text-gray-600">No wallet transactions yet.</div>
            ) : (
              <div className="space-y-3">
                {transactions.map((txn) => (
                  <div key={txn.id} className="border rounded-xl p-4">
                    <div className="font-medium">{txn.tx_type}</div>
                    <div className="text-sm text-gray-700 mt-2">
                      Amount: {money(txn.amount)}
                    </div>
                    {txn.trip_id && (
                      <div className="text-sm text-gray-700 mt-1 break-all">
                        Trip: {txn.trip_id}
                      </div>
                    )}
                    {txn.note && (
                      <div className="text-sm text-gray-700 mt-1">{txn.note}</div>
                    )}
                    <div className="text-xs text-gray-500 mt-2">
                      {txn.created_at ? new Date(txn.created_at).toLocaleString() : "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}