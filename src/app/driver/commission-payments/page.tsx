"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { DRIVER_COMMISSION_LOCK_LIMIT } from "@/lib/finance/commission";
import { supabaseClient } from "@/lib/supabase/client";

type Wallet = {
  balance_due: number | null;
  total_commission: number | null;
  total_driver_net: number | null;
  total_trips_completed: number | null;
};

type DriverInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type PaymentRequest = {
  id: string;
  payment_type: "subscription" | "commission" | "combined";
  amount_expected: number;
  amount_submitted: number;
  payment_reference: string;
  status: string;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};

type Settlement = {
  id: string;
  amount_paid: number;
  reference: string | null;
  note: string | null;
  created_at: string;
};

type CompletedTrip = {
  id: string;
  fare_amount: number | null;
  commission_amount: number | null;
  driver_net_earnings: number | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  completed_at?: string | null;
  created_at: string | null;
};

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function paymentStatus(balanceDue: number) {
  if (balanceDue >= DRIVER_COMMISSION_LOCK_LIMIT) return "Payment required";
  if (balanceDue >= DRIVER_COMMISSION_LOCK_LIMIT * 0.7) return "Warning";
  return "Good standing";
}

export default function DriverCommissionPaymentsPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [trips, setTrips] = useState<CompletedTrip[]>([]);
  const [amountSubmitted, setAmountSubmitted] = useState("");
  const [note, setNote] = useState("");
  const [popFile, setPopFile] = useState<File | null>(null);

  const getToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token || "";
  }, []);

  const loadData = useCallback(async () => {
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
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      setMsg(json?.error || "Failed to load commission payments.");
      setLoading(false);
      return;
    }

    const balanceDue = Number(json.earnings?.wallet?.balance_due ?? 0);
    setWallet(json.earnings?.wallet ?? null);
    setDriver(json.earnings?.driver ?? null);
    setPaymentRequests(
      (json.earnings?.payment_requests ?? []).filter(
        (row: PaymentRequest) => row.payment_type === "commission"
      )
    );
    setSettlements(json.earnings?.settlements ?? []);
    setTrips(json.earnings?.recent_completed_trips ?? []);
    setAmountSubmitted(balanceDue > 0 ? balanceDue.toFixed(2) : "");
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  const balanceDue = Number(wallet?.balance_due ?? 0);
  const remainingBeforeLock = Math.max(0, DRIVER_COMMISSION_LOCK_LIMIT - balanceDue);
  const lockProgress = Math.min(
    100,
    Math.max(0, (balanceDue / DRIVER_COMMISSION_LOCK_LIMIT) * 100)
  );
  const pendingCommission = useMemo(
    () =>
      paymentRequests.find((row) =>
        ["pending_payment_review", "waiting_confirmation"].includes(row.status)
      ) ?? null,
    [paymentRequests]
  );
  const lastApprovedPayment = settlements[0] ?? null;
  const driverName = `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver";

  async function submitCommissionPayment() {
    if (balanceDue <= 0) {
      setMsg("You do not currently owe MOOVU commission.");
      return;
    }

    if (pendingCommission) {
      setMsg("You already have a pending commission payment waiting for admin review.");
      return;
    }

    if (!popFile) {
      setMsg("Please upload proof of payment before submitting.");
      return;
    }

    setBusy(true);
    setMsg(null);

    const token = await getToken();
    if (!token) {
      setBusy(false);
      setMsg("You are not logged in.");
      return;
    }

    const formData = new FormData();
    formData.append("paymentType", "commission");
    formData.append("amountSubmitted", amountSubmitted || balanceDue.toFixed(2));
    formData.append("note", note);
    formData.append("pop", popFile);

    const res = await fetch("/api/driver/payment-request", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const json = await res.json().catch(() => null);
    setBusy(false);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to submit commission payment.");
      return;
    }

    setMsg(`${json.message} Reference: ${json.paymentReference}`);
    setNote("");
    setPopFile(null);
    await loadData();
  }

  if (loading) {
    return (
      <LoadingState
        title="Loading commission payments"
        description="Checking your MOOVU commission balance and payment history."
      />
    );
  }

  return (
    <main className="moovu-page text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-shell space-y-6">
        <section className="moovu-card overflow-hidden p-0">
          <div className="bg-[linear-gradient(135deg,#f8fbff_0%,#eef8ff_46%,#f0fffa_100%)] p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="moovu-section-title">MOOVU Driver</div>
                <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
                  Commission payments
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Pay only your MOOVU trip commission here. Subscription payments stay under Subscriptions.
                </p>
              </div>
              <Link href="/driver/earnings" className="moovu-btn moovu-btn-secondary">
                Back to earnings
              </Link>
            </div>
          </div>

          <div className="grid gap-3 border-t border-[var(--moovu-border)] p-4 sm:grid-cols-3 sm:p-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                Current status
              </p>
              <div className="mt-2">
                <StatusBadge
                  status={
                    balanceDue >= DRIVER_COMMISSION_LOCK_LIMIT
                      ? "payment_required"
                      : balanceDue > 0
                        ? "warning"
                        : "good_standing"
                  }
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-bold text-slate-700">R100 online lock limit</span>
                <span className="font-black text-slate-950">{money(balanceDue)}</span>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${
                    balanceDue >= DRIVER_COMMISSION_LOCK_LIMIT
                      ? "bg-red-500"
                      : balanceDue > 0
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                  style={{ width: `${lockProgress}%` }}
                />
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-500">
                {balanceDue >= DRIVER_COMMISSION_LOCK_LIMIT
                  ? "Payment is required before you can go online again."
                  : `${money(remainingBeforeLock)} remaining before the online lock.`}
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Commission owed" value={money(balanceDue)} helper="Payable to MOOVU" tone={balanceDue > 0 ? "warning" : "success"} />
          <MetricCard label="Debt limit" value={money(DRIVER_COMMISSION_LOCK_LIMIT)} helper="Online lock threshold" tone="primary" />
          <MetricCard label="Before lock" value={money(remainingBeforeLock)} helper="Remaining available balance" />
          <MetricCard label="Status" value={paymentStatus(balanceDue)} helper={driverName} tone={balanceDue >= DRIVER_COMMISSION_LOCK_LIMIT ? "danger" : balanceDue > 0 ? "warning" : "success"} />
        </section>

        {balanceDue >= DRIVER_COMMISSION_LOCK_LIMIT ? (
          <section className="rounded-[28px] border border-red-200 bg-red-50 p-5 text-red-900 shadow-[0_16px_34px_rgba(220,38,38,0.08)]">
            <div className="text-sm font-black uppercase tracking-[0.12em] text-red-700">
              Online access locked
            </div>
            <p className="mt-2 text-sm leading-6">
              Your MOOVU commission balance is {money(balanceDue)}. Submit a commission POP for admin review to restore online access after approval.
            </p>
          </section>
        ) : balanceDue > 0 ? (
          <section className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-[0_16px_34px_rgba(245,158,11,0.08)]">
            <div className="text-sm font-black uppercase tracking-[0.12em] text-amber-700">
              Commission balance active
            </div>
            <p className="mt-2 text-sm leading-6">
              You can keep driving while your balance stays below {money(DRIVER_COMMISSION_LOCK_LIMIT)}. Paying early keeps your account in good standing.
            </p>
          </section>
        ) : null}

        <section className="moovu-card p-5 sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="moovu-card-interactive p-5">
              <h2 className="text-xl font-black text-slate-950">Payment status</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <div className="rounded-2xl bg-white p-4 shadow-[0_10px_24px_rgba(31,116,201,0.06)]">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                    Pending request
                  </p>
                  <p className="mt-1 font-bold text-slate-950">
                    {pendingCommission ? pendingCommission.payment_reference : "None"}
                  </p>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-[0_10px_24px_rgba(31,116,201,0.06)]">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                    Last approved payment
                  </p>
                  <p className="mt-1 font-bold text-slate-950">
                    {lastApprovedPayment
                      ? `${money(lastApprovedPayment.amount_paid)} on ${displayDate(lastApprovedPayment.created_at)}`
                      : "None"}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--moovu-border)] bg-white/70 p-4">
                  Commission comes from completed trips and cannot be edited by drivers.
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-[var(--moovu-border)] bg-white p-5 shadow-[0_16px_34px_rgba(31,116,201,0.07)]">
              <h2 className="text-xl font-black text-slate-950">Pay MOOVU commission</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Upload your proof of payment after paying the expected amount. Admin review keeps commission clearing controlled and traceable.
              </p>
              <div className="mt-4 space-y-4">
              <input
                className="moovu-input"
                type="number"
                min="0"
                step="0.01"
                value={amountSubmitted}
                onChange={(event) => setAmountSubmitted(event.target.value)}
                placeholder="Amount paid"
              />
              <input
                className="moovu-input"
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                onChange={(event) => setPopFile(event.target.files?.[0] ?? null)}
              />
              <textarea
                className="moovu-input min-h-24 resize-none"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional note for admin"
              />
              <button
                type="button"
                className="moovu-btn moovu-btn-primary w-full"
                disabled={busy || balanceDue <= 0 || !!pendingCommission}
                onClick={() => void submitCommissionPayment()}
              >
                {busy ? "Submitting..." : "Pay MOOVU commission"}
              </button>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="moovu-card p-5 sm:p-6">
            <h2 className="text-xl font-black text-slate-950">Commission payment requests</h2>
            <div className="mt-4 space-y-3">
              {paymentRequests.length === 0 ? (
                <EmptyState title="No commission requests" description="Submitted commission POP requests will appear here." />
              ) : (
                paymentRequests.map((row) => (
                  <div key={row.id} className="moovu-card-interactive p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-black text-slate-950">{row.payment_reference}</div>
                        <div className="text-sm text-slate-600">{displayDate(row.submitted_at)}</div>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>Expected: {money(row.amount_expected)}</div>
                      <div>Submitted: {money(row.amount_submitted)}</div>
                    </div>
                    {row.review_note && <div className="mt-3 text-sm text-slate-700">Admin note: {row.review_note}</div>}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="moovu-card p-5 sm:p-6">
            <h2 className="text-xl font-black text-slate-950">Completed trips contributing</h2>
            <div className="mt-4 space-y-3">
              {trips.length === 0 ? (
                <EmptyState title="No completed trips" description="Commission appears after completed trips." />
              ) : (
                trips.slice(0, 10).map((trip) => (
                  <div key={trip.id} className="moovu-card-interactive p-4">
                    <div className="font-semibold text-slate-950">{trip.pickup_address || "Pickup"} to {trip.dropoff_address || "Destination"}</div>
                    <div className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
                      <div>Fare: {money(trip.fare_amount)}</div>
                      <div>MOOVU: {money(trip.commission_amount)}</div>
                      <div>Net: {money(trip.driver_net_earnings)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
