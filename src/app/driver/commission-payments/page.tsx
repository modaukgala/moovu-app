"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import DriverSectionTabs from "@/components/app-shell/DriverSectionTabs";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import DriverAuthRequired from "@/components/ui/DriverAuthRequired";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { openHostedPaymentCheckout } from "@/lib/payments/checkoutNavigation";
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

type FinanceAuthority = {
  mode: string;
  netOwedCents: number;
  thresholdCents: number;
  subscriptionRequired: boolean;
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
  return balanceDue > 0 ? "Commission due" : "Settled";
}

export default function DriverCommissionPaymentsPage() {
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [finance, setFinance] = useState<FinanceAuthority | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [trips, setTrips] = useState<CompletedTrip[]>([]);

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
      setAuthRequired(true);
      setLoading(false);
      return;
    }

    setAuthRequired(false);

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

    const authority = json.earnings?.finance_authority as FinanceAuthority | undefined;
    setWallet(json.earnings?.wallet ?? null);
    setDriver(json.earnings?.driver ?? null);
    setFinance(authority ?? null);
    setPaymentRequests(
      (json.earnings?.payment_requests ?? []).filter(
        (row: PaymentRequest) => row.payment_type === "commission"
      )
    );
    setSettlements(json.earnings?.settlements ?? []);
    setTrips(json.earnings?.recent_completed_trips ?? []);
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  const balanceDue = finance ? Number(finance.netOwedCents ?? 0) / 100 : Number(wallet?.balance_due ?? 0);

  const pendingCommission = useMemo(
    () =>
      paymentRequests.find((row) =>
        ["pending_payment_review", "waiting_confirmation"].includes(row.status)
      ) ?? null,
    [paymentRequests]
  );
  const lastApprovedPayment = settlements[0] ?? null;
  const driverName = `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver";

  async function payOnline() {
    setBusy(true);
    setMsg(null);
    const token = await getToken();
    if (!token) { setBusy(false); setMsg("You are not logged in."); return; }
    const response = await fetch("/api/payments/yoco/driver/checkout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.redirectUrl) {
      setBusy(false);
      setMsg(body?.error ?? "Online payment is currently unavailable.");
      return;
    }
    try {
      await openHostedPaymentCheckout(body.redirectUrl, {
        returnPath: `/driver/payment/success?attemptId=${encodeURIComponent(body.attemptId)}`,
      });
    } catch (error) {
      setBusy(false);
      setMsg(error instanceof Error ? error.message : "Unable to open secure checkout.");
    }
  }

  if (loading) {
    return (
      <LoadingState
        title="Loading commission payments"
        description="Checking your MOOVU commission balance and payment history."
      />
    );
  }

  if (authRequired) {
    return <DriverAuthRequired description="Sign in to manage your MOOVU commission payments." />;
  }

  return (
    <main className="moovu-page moovu-driver-shell text-black">
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
            </div>
            <DriverSectionTabs section="money" />
          </div>

          <div className="border-t border-[var(--moovu-border)] p-5">
            <p className="text-sm font-bold text-slate-600">Commission due</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{money(balanceDue)}</p>
            <p className="mt-2 text-sm text-slate-600">{balanceDue > 0 ? "Pay your outstanding commission securely online." : "Your commission is settled."}</p>
          </div>
        </section>
        <section className="moovu-driver-metric-grid moovu-driver-metric-grid-3">
          <MetricCard label="Commission owed" value={money(balanceDue)} helper="Payable to MOOVU" />
          <MetricCard label="Status" value={paymentStatus(balanceDue)} helper={driverName} tone={balanceDue > 0 ? "default" : "success"} />
        </section>

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

            <div className="space-y-4">
              <div className="rounded-[28px] border border-[var(--moovu-border)] bg-white p-5 shadow-[0_16px_34px_rgba(31,116,201,0.07)]">
              <h2 className="text-xl font-black text-slate-950">Pay MOOVU commission</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                The payable amount comes from MOOVU&apos;s authoritative ledger and cannot be edited. Settlement happens only after Yoco&apos;s verified webhook.
              </p>
              <div className="mt-4 space-y-4">
              {finance?.mode === "AUTHORITATIVE" && !finance.subscriptionRequired && balanceDue > 0 && (
                <button type="button" className="moovu-btn moovu-btn-primary w-full" disabled={busy} onClick={() => void payOnline()}>
                  {busy ? "Preparing secure checkout..." : `Pay ${money(balanceDue)} online with Yoco`}
                </button>
              )}
              {balanceDue <= 0 && <div className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">No commission is currently payable.</div>}
              </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="moovu-card p-5 sm:p-6">
            <h2 className="text-xl font-black text-slate-950">Historical manual requests</h2>
            <div className="mt-4 space-y-3">
              {paymentRequests.length === 0 ? (
                <EmptyState title="No historical requests" description="No previous manual commission requests were found." />
              ) : (
                paymentRequests.map((row) => (
                  <div key={row.id} className="moovu-card-interactive p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-black text-slate-950">{row.payment_reference}</div>
                        <div className="text-sm text-slate-600">{displayDate(row.submitted_at)}</div>
                        <Link
                          href={`/driver/payment-receipts/${row.id}`}
                          className="mt-1 inline-flex text-xs font-black text-[var(--moovu-primary)]"
                        >
                          Open receipt
                        </Link>
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
      <DriverBottomNav />
    </main>
  );
}
