"use client";

import { useEffect, useMemo, useState } from "react";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type DriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  wallet_summary: {
    balance_due: number | null;
    total_commission: number | null;
    total_driver_net: number | null;
    total_trips_completed: number | null;
    total_paid: number | null;
    last_payment_at: string | null;
    last_payment_amount: number | null;
    account_status: string | null;
  };
};

type SettlementRow = {
  id: string;
  driver_id: string;
  driver_name: string;
  wallet_id: string | null;
  amount_paid: number;
  payment_method: string;
  reference: string | null;
  note: string | null;
  created_at: string;
};

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

export default function AdminSettlementsPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);

  const [driverId, setDriverId] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

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

    const res = await fetch("/api/admin/settlements", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load settlements.");
      setLoading(false);
      return;
    }

    setDrivers(json.drivers ?? []);
    setSettlements(json.settlements ?? []);
    setLoading(false);
  }

  async function postSettlement(payload: {
    driverId: string;
    amountPaid: number;
    paymentMethod: string;
    reference: string;
    note: string;
  }) {
    const token = await getToken();
    if (!token) {
      setMsg("You are not logged in.");
      return { ok: false };
    }

    const res = await fetch("/api/admin/settlements/record", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    return res.json().catch(() => null);
  }

  async function recordSettlement() {
    if (!driverId) {
      setMsg("Select a driver.");
      return;
    }

    if (!amountPaid || Number(amountPaid) <= 0) {
      setMsg("Enter a valid payment amount.");
      return;
    }

    setBusy(true);
    setMsg(null);

    const json = await postSettlement({
      driverId,
      amountPaid: Number(amountPaid),
      paymentMethod,
      reference,
      note,
    });

    if (!json?.ok) {
      setMsg(json?.error || "Failed to record settlement.");
      setBusy(false);
      return;
    }

    setMsg(json?.message || "Settlement recorded successfully.");
    setAmountPaid("");
    setReference("");
    setNote("");
    await loadData();
    setBusy(false);
  }

  async function clearFullBalance() {
    if (!selectedDriver) {
      setMsg("Select a driver first.");
      return;
    }

    const fullBalance = Number(selectedDriver.wallet?.balance_due ?? 0);

    if (fullBalance <= 0) {
      setMsg("This driver does not currently owe MOOVU any commission balance.");
      return;
    }

    setBusy(true);
    setMsg(null);

    const autoReference =
      reference.trim() || `COMM-CLEAR-${selectedDriver.id.slice(0, 6).toUpperCase()}`;
    const autoNote =
      note.trim() || "Full commission balance cleared by admin after payment received.";

    const json = await postSettlement({
      driverId: selectedDriver.id,
      amountPaid: fullBalance,
      paymentMethod,
      reference: autoReference,
      note: autoNote,
    });

    if (!json?.ok) {
      setMsg(json?.error || "Failed to clear full balance.");
      setBusy(false);
      return;
    }

    setMsg("Full commission balance cleared successfully.");
    setAmountPaid("");
    setReference("");
    setNote("");
    await loadData();
    setBusy(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const driverOptions = useMemo(() => {
    return drivers.map((driver) => {
      const label =
        `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() ||
        driver.phone ||
        driver.id;

      return {
        id: driver.id,
        label,
        wallet: driver.wallet_summary,
      };
    });
  }, [drivers]);

  const selectedDriver = driverOptions.find((d) => d.id === driverId) ?? null;

  return (
    <main className="space-y-6 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-card p-5 sm:p-6">
          <div className="moovu-section-title">MOOVU Admin</div>
          <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">Driver settlements</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Record driver payments and monitor outstanding balances owed to MOOVU.
          </p>
        </div>

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Record settlement</h2>

          <select
            className="border rounded-xl p-3 w-full"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
          >
            <option value="">Select driver</option>
            {driverOptions.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.label} - Balance Due: {money(driver.wallet?.balance_due)}
              </option>
            ))}
          </select>

          {selectedDriver && (
            <div className="grid md:grid-cols-4 gap-4 border rounded-2xl p-4">
              <div>
                <div className="text-sm text-gray-500">Balance Due</div>
                <div className="font-semibold">{money(selectedDriver.wallet?.balance_due)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Total Commission</div>
                <div className="font-semibold">{money(selectedDriver.wallet?.total_commission)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Total Paid</div>
                <div className="font-semibold">{money(selectedDriver.wallet?.total_paid)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Trips Completed</div>
                <div className="font-semibold">{selectedDriver.wallet?.total_trips_completed ?? 0}</div>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <input
              className="border rounded-xl p-3"
              placeholder="Amount paid"
              type="number"
              min="0"
              step="0.01"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
            />

            <select
              className="border rounded-xl p-3"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="cash">Cash</option>
              <option value="eft">EFT</option>
              <option value="transfer">Transfer</option>
              <option value="deposit">Deposit</option>
            </select>

            <input
              className="border rounded-xl p-3"
              placeholder="Reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />

            <input
              className="border rounded-xl p-3"
              placeholder="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={recordSettlement}
              disabled={busy}
              className="rounded-xl px-4 py-3 text-white"
              style={{ background: "var(--moovu-primary)" }}
            >
              {busy ? "Saving..." : "Record Settlement"}
            </button>

            <button
              onClick={clearFullBalance}
              disabled={busy || !selectedDriver || Number(selectedDriver.wallet?.balance_due ?? 0) <= 0}
              className="border rounded-xl px-4 py-3 bg-white"
            >
              Clear Full Balance
            </button>
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Driver wallet balances</h2>

          {loading ? (
            <div>Loading balances...</div>
          ) : (
            <div className="space-y-3">
              {driverOptions.map((driver) => (
                <div key={driver.id} className="border rounded-2xl p-4">
                  <div className="grid md:grid-cols-6 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Driver</div>
                      <div className="font-medium">{driver.label}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Balance Due</div>
                      <div className="font-medium">{money(driver.wallet?.balance_due)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Total Commission</div>
                      <div className="font-medium">{money(driver.wallet?.total_commission)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Total Paid</div>
                      <div className="font-medium">{money(driver.wallet?.total_paid)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Trips Completed</div>
                      <div className="font-medium">{driver.wallet?.total_trips_completed ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Last Payment</div>
                      <div className="font-medium">
                        {driver.wallet?.last_payment_at
                          ? `${money(driver.wallet?.last_payment_amount)} - ${new Date(driver.wallet.last_payment_at).toLocaleString()}`
                          : "--"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Recent settlements</h2>

          {settlements.length === 0 ? (
            <div>No settlements recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {settlements.map((row) => (
                <div key={row.id} className="border rounded-2xl p-4">
                  <div className="grid md:grid-cols-5 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Driver</div>
                      <div className="font-medium">{row.driver_name}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Amount</div>
                      <div className="font-medium">{money(row.amount_paid)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Method</div>
                      <div className="font-medium">{row.payment_method}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Reference</div>
                      <div className="font-medium">{row.reference || "--"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Date</div>
                      <div className="font-medium">{new Date(row.created_at).toLocaleString()}</div>
                    </div>
                  </div>

                  {row.note && (
                    <div className="mt-3 text-sm text-gray-700">{row.note}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
    </main>
  );
}
