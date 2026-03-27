"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";

type Driver = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  id_number: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

type Vehicle = {
  id: string;
  driver_id: string;
  make: string | null;
  model: string | null;
  color: string | null;
  plate_number: string;
  vehicle_type: string;
  is_active: boolean;
  created_at: string;
};

type DriverDoc = {
  id: string;
  driver_id: string;
  doc_type: string;
  file_path: string;
  status: string;
  expires_on: string | null;
  uploaded_at: string;
};

type DriverWallet = {
  id: string;
  driver_id: string;
  balance_due: number;
  total_commission: number;
  total_driver_net: number;
  total_trips_completed: number;
  updated_at: string;
  created_at: string;
};

type WalletTransaction = {
  id: string;
  driver_id: string;
  wallet_id: string;
  trip_id: string | null;
  tx_type: string;
  amount: number;
  direction: string;
  description: string | null;
  created_at: string;
};

export default function DriverDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const driverId = params.id;

  const [driver, setDriver] = useState<Driver | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [docs, setDocs] = useState<DriverDoc[]>([]);
  const [wallet, setWallet] = useState<DriverWallet | null>(null);
  const [walletTxs, setWalletTxs] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Vehicle form
  const [vMake, setVMake] = useState("");
  const [vModel, setVModel] = useState("");
  const [vColor, setVColor] = useState("");
  const [vPlate, setVPlate] = useState("");
  const [vType, setVType] = useState("car");

  // Notes form
  const [notes, setNotes] = useState("");

  // Payment form
  const [paymentAmount, setPaymentAmount] = useState("");

  async function loadAll() {
    setLoading(true);

    const { data: d } = await supabaseClient
      .from("drivers")
      .select("*")
      .eq("id", driverId)
      .single();

    const { data: v } = await supabaseClient
      .from("vehicles")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    const { data: doc } = await supabaseClient
      .from("driver_documents")
      .select("*")
      .eq("driver_id", driverId)
      .order("uploaded_at", { ascending: false });

    const { data: w } = await supabaseClient
      .from("driver_wallets")
      .select("*")
      .eq("driver_id", driverId)
      .maybeSingle();

    const { data: txs } = await supabaseClient
      .from("driver_wallet_transactions")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    setDriver((d as Driver) ?? null);
    setVehicles((v as Vehicle[]) ?? []);
    setDocs((doc as DriverDoc[]) ?? []);
    setWallet((w as DriverWallet) ?? null);
    setWalletTxs((txs as WalletTransaction[]) ?? []);
    setNotes(d?.notes ?? "");
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, [driverId]);

  const title = useMemo(() => {
    if (!driver) return "Driver";
    return `${driver.first_name} ${driver.last_name}`;
  }, [driver]);

  async function updateDriverStatus(status: string) {
    await supabaseClient
      .from("drivers")
      .update({ status })
      .eq("id", driverId);

    await loadAll();
  }

  async function saveNotes() {
    await supabaseClient
      .from("drivers")
      .update({ notes })
      .eq("id", driverId);

    await loadAll();
  }

  async function addVehicle(e: React.FormEvent) {
    e.preventDefault();

    if (!vPlate.trim()) return;

    await supabaseClient.from("vehicles").insert({
      driver_id: driverId,
      make: vMake || null,
      model: vModel || null,
      color: vColor || null,
      plate_number: vPlate.trim(),
      vehicle_type: vType,
      is_active: true,
    });

    setVMake("");
    setVModel("");
    setVColor("");
    setVPlate("");
    setVType("car");

    await loadAll();
  }

  async function approveDoc(docId: string, status: "approved" | "rejected") {
    await supabaseClient
      .from("driver_documents")
      .update({ status })
      .eq("id", docId);

    await loadAll();
  }

  async function recordDriverPayment() {
    const amount = Number(paymentAmount);

    if (!wallet || !Number.isFinite(amount) || amount <= 0) return;

    const { data: userData } = await supabaseClient.auth.getUser();
    const createdBy = userData.user?.id ?? null;

    const { error: txError } = await supabaseClient
      .from("driver_wallet_transactions")
      .insert({
        driver_id: driverId,
        wallet_id: wallet.id,
        trip_id: null,
        tx_type: "payment",
        amount,
        direction: "credit",
        description: `Driver paid Moovu R${amount}`,
        created_by: createdBy,
      });

    if (txError) return;

    const newBalance = Math.max(0, Number(wallet.balance_due || 0) - amount);

    await supabaseClient
      .from("driver_wallets")
      .update({
        balance_due: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq("id", wallet.id);

    setPaymentAmount("");
    await loadAll();
  }

  if (loading) {
    return <main className="p-6">Loading driver...</main>;
  }

  if (!driver) {
    return (
      <main className="p-6">
        <p>Driver not found.</p>
        <button
          className="border rounded-xl px-4 py-2 mt-3"
          onClick={() => router.push("/admin/drivers")}
        >
          Back
        </button>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="opacity-70 mt-1">
            Status: <span className="capitalize">{driver.status}</span> • Phone: {driver.phone}
            {driver.email ? ` • Email: ${driver.email}` : ""}
          </p>
        </div>

        <div className="flex gap-2">
          {driver.status === "pending" && (
            <button
              className="border rounded-xl px-4 py-2"
              onClick={() => updateDriverStatus("approved")}
            >
              Approve
            </button>
          )}

          {driver.status !== "suspended" && (
            <button
              className="border rounded-xl px-4 py-2"
              onClick={() => updateDriverStatus("suspended")}
            >
              Suspend
            </button>
          )}

          {driver.status === "suspended" && (
            <button
              className="border rounded-xl px-4 py-2"
              onClick={() => updateDriverStatus("active")}
            >
              Activate
            </button>
          )}
        </div>
      </div>

      <section className="border rounded-2xl p-5">
        <h2 className="font-semibold">Notes</h2>
        <textarea
          className="w-full border rounded-xl p-3 mt-3 min-h-[120px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add internal notes about this driver..."
        />
        <div className="mt-3">
          <button className="border rounded-xl px-4 py-2" onClick={saveNotes}>
            Save Notes
          </button>
        </div>
      </section>

      <section className="border rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Documents</h2>
          <a
            className="text-sm underline opacity-80"
            href={`/admin/drivers/${driverId}/documents/upload`}
          >
            Upload document
          </a>
        </div>

        {docs.length === 0 ? (
          <p className="opacity-70 mt-3">No documents uploaded yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {docs.map((d) => (
              <div key={d.id} className="border rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium capitalize">{d.doc_type}</div>
                    <div className="text-sm opacity-70">
                      Status: <span className="capitalize">{d.status}</span>
                      {d.expires_on ? ` • Expires: ${d.expires_on}` : ""}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <a
                      className="border rounded-lg px-3 py-1 text-sm"
                      href={`/admin/drivers/${driverId}/documents/view?path=${encodeURIComponent(
                        d.file_path
                      )}`}
                    >
                      View
                    </a>

                    {d.status !== "approved" && (
                      <button
                        className="border rounded-lg px-3 py-1 text-sm"
                        onClick={() => approveDoc(d.id, "approved")}
                      >
                        Approve
                      </button>
                    )}

                    {d.status !== "rejected" && (
                      <button
                        className="border rounded-lg px-3 py-1 text-sm"
                        onClick={() => approveDoc(d.id, "rejected")}
                      >
                        Reject
                      </button>
                    )}
                  </div>
                </div>

                <div className="text-xs opacity-60 break-all">{d.file_path}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border rounded-2xl p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Driver Commission Balance</h2>
            <p className="text-sm opacity-70 mt-1">
              This is the amount the driver owes Moovu from completed trips.
            </p>
          </div>
        </div>

        {!wallet ? (
          <p className="opacity-70 mt-4">No wallet activity yet.</p>
        ) : (
          <>
            <div className="grid md:grid-cols-4 gap-4 mt-4">
              <div className="border rounded-xl p-4">
                <div className="text-sm opacity-70">Balance Due</div>
                <div className="text-xl font-semibold">
                  R{Number(wallet.balance_due || 0).toFixed(2)}
                </div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-sm opacity-70">Total Commission</div>
                <div className="text-xl font-semibold">
                  R{Number(wallet.total_commission || 0).toFixed(2)}
                </div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-sm opacity-70">Driver Net</div>
                <div className="text-xl font-semibold">
                  R{Number(wallet.total_driver_net || 0).toFixed(2)}
                </div>
              </div>

              <div className="border rounded-xl p-4">
                <div className="text-sm opacity-70">Completed Trips</div>
                <div className="text-xl font-semibold">{wallet.total_trips_completed}</div>
              </div>
            </div>

            <div className="mt-5 border rounded-xl p-4">
              <div className="font-medium">Record driver payment</div>
              <div className="flex gap-3 mt-3">
                <input
                  className="border rounded-xl p-3 w-full max-w-xs"
                  placeholder="Amount paid"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
                <button
                  className="border rounded-xl px-4 py-2"
                  onClick={recordDriverPayment}
                >
                  Record Payment
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {walletTxs.length === 0 ? (
                <p className="opacity-70">No wallet transactions yet.</p>
              ) : (
                walletTxs.map((tx) => (
                  <div key={tx.id} className="border rounded-xl p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium capitalize">
                        {tx.tx_type} • {tx.direction}
                      </div>
                      <div className="font-semibold">
                        R{Number(tx.amount).toFixed(2)}
                      </div>
                    </div>

                    {tx.description && (
                      <div className="text-sm opacity-70 mt-2">{tx.description}</div>
                    )}

                    <div className="text-xs opacity-60 mt-2">
                      {new Date(tx.created_at).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </section>

      <section className="border rounded-2xl p-5">
        <h2 className="font-semibold">Vehicles</h2>

        <form onSubmit={addVehicle} className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-4">
          <input
            className="border rounded-xl p-3"
            placeholder="Make"
            value={vMake}
            onChange={(e) => setVMake(e.target.value)}
          />

          <input
            className="border rounded-xl p-3"
            placeholder="Model"
            value={vModel}
            onChange={(e) => setVModel(e.target.value)}
          />

          <input
            className="border rounded-xl p-3"
            placeholder="Color"
            value={vColor}
            onChange={(e) => setVColor(e.target.value)}
          />

          <input
            className="border rounded-xl p-3"
            placeholder="Plate number *"
            value={vPlate}
            onChange={(e) => setVPlate(e.target.value)}
            required
          />

          <select
            className="border rounded-xl p-3"
            value={vType}
            onChange={(e) => setVType(e.target.value)}
          >
            <option value="car">Car</option>
            <option value="hatchback">Hatchback</option>
            <option value="sedan">Sedan</option>
            <option value="suv">SUV</option>
            <option value="minibus">Minibus</option>
            <option value="other">Other</option>
          </select>

          <div className="md:col-span-5">
            <button className="border rounded-xl px-4 py-2">Add Vehicle</button>
          </div>
        </form>

        {vehicles.length === 0 ? (
          <p className="opacity-70 mt-4">No vehicles added yet.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {vehicles.map((v) => (
              <div key={v.id} className="border rounded-xl p-4">
                <div className="font-medium">
                  {v.plate_number} • <span className="capitalize">{v.vehicle_type}</span>
                </div>
                <div className="text-sm opacity-70">
                  {[v.make, v.model, v.color].filter(Boolean).join(" • ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}