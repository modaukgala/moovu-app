"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import DriverAuthRequired from "@/components/ui/DriverAuthRequired";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import {
  DRIVER_SUBSCRIPTION_PLANS,
  type DriverSubscriptionPlan,
} from "@/lib/finance/driverPayments";
import { requestNativeCameraPermissions } from "@/lib/native-permissions";
import { supabaseClient } from "@/lib/supabase/client";

type DriverInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
  subscription_amount_due: number | null;
};

type PaymentRequest = {
  id: string;
  payment_type: "subscription" | "commission" | "combined";
  subscription_plan: DriverSubscriptionPlan | null;
  amount_expected: number;
  amount_submitted: number;
  payment_reference: string;
  status: string;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};

type SubscriptionPayment = {
  id: string;
  amount_paid: number;
  payment_method: string;
  reference: string | null;
  note: string | null;
  created_at: string;
};

const BANK_DETAILS = {
  bankName: "NEDBANK",
  accountName: "Current Account",
  accountNumber: "2129562558",
  branchCode: "198765",
};

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function daysRemaining(value: string | null | undefined) {
  if (!value) return 0;
  const diff = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function planLabel(plan: DriverSubscriptionPlan | string | null | undefined) {
  if (plan === "day" || plan === "week" || plan === "month") {
    const item = DRIVER_SUBSCRIPTION_PLANS[plan];
    return `${item.label} ${money(item.amount)}`;
  }
  return "No active plan";
}

export default function DriverSubscriptionsPage() {
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<DriverSubscriptionPlan>("week");
  const [amountSubmitted, setAmountSubmitted] = useState(String(DRIVER_SUBSCRIPTION_PLANS.week.amount));
  const [note, setNote] = useState("");
  const [popFile, setPopFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const selectedPlanDetails = DRIVER_SUBSCRIPTION_PLANS[selectedPlan];
  const pendingRequest = useMemo(
    () =>
      requests.find((row) =>
        ["pending_payment_review", "waiting_confirmation"].includes(row.status)
      ) ?? null,
    [requests],
  );
  const approvedRequests = requests.filter((row) => row.status === "approved");
  const rejectedRequests = requests.filter((row) => row.status === "rejected");

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
      setMsg(json?.error || "Failed to load subscription payments.");
      setLoading(false);
      return;
    }

    setDriver(json.earnings?.driver ?? null);
    setRequests(
      ((json.earnings?.payment_requests ?? []) as PaymentRequest[]).filter(
        (row) => row.payment_type === "subscription",
      ),
    );
    setPayments(json.earnings?.subscription_payments ?? []);
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  async function submitSubscriptionPayment() {
    if (pendingRequest) {
      setMsg("You already have a subscription payment waiting for admin review.");
      return;
    }
    if (!popFile) {
      setMsg("Please upload proof of payment before submitting.");
      return;
    }
    if (!confirmed) {
      setMsg("Please confirm that the payment amount and reference are correct.");
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
    formData.append("paymentType", "subscription");
    formData.append("subscriptionPlan", selectedPlan);
    formData.append("amountSubmitted", amountSubmitted || String(selectedPlanDetails.amount));
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
      setMsg(json?.error || "Failed to submit subscription payment.");
      return;
    }

    setMsg(`${json.message} Reference: ${json.paymentReference}`);
    setNote("");
    setPopFile(null);
    setConfirmed(false);
    await loadData();
  }

  if (loading) {
    return (
      <LoadingState
        title="Loading subscriptions"
        description="Checking your plan, expiry, and payment history."
      />
    );
  }

  if (authRequired) {
    return <DriverAuthRequired description="Sign in to manage your MOOVU driver subscription." />;
  }

  return (
    <main className="moovu-page moovu-driver-shell pb-28 text-slate-950">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-shell space-y-6">
        <section className="moovu-card overflow-hidden p-0">
          <div className="bg-[linear-gradient(135deg,#f8fbff_0%,#eef8ff_46%,#f0fffa_100%)] p-5 sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="moovu-section-title">MOOVU Driver</div>
                <h1 className="mt-2 text-2xl font-black sm:text-3xl">
                  Subscriptions
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Keep your driver access active with a clean daily, weekly, or monthly subscription POP.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/driver/earnings" className="moovu-btn moovu-btn-secondary">
                  Earnings
                </Link>
                <Link href="/driver/commission-payments" className="moovu-btn moovu-btn-primary">
                  Commission
                </Link>
              </div>
            </div>
          </div>

          <div className="grid gap-3 border-t border-[var(--moovu-border)] p-4 sm:grid-cols-4 sm:p-5">
            <MetricCard label="Status" value={driver?.subscription_status ?? "inactive"} helper="Current access" tone={driver?.subscription_status === "active" ? "success" : "warning"} />
            <MetricCard label="Plan" value={planLabel(driver?.subscription_plan)} helper="Current plan" />
            <MetricCard label="Expires" value={displayDate(driver?.subscription_expires_at)} helper={`${daysRemaining(driver?.subscription_expires_at)} day(s) remaining`} />
            <MetricCard label="Pending POP" value={pendingRequest ? "Yes" : "No"} helper={pendingRequest?.payment_reference ?? "No active review"} tone={pendingRequest ? "warning" : "success"} />
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          {(Object.entries(DRIVER_SUBSCRIPTION_PLANS) as Array<[DriverSubscriptionPlan, typeof DRIVER_SUBSCRIPTION_PLANS[DriverSubscriptionPlan]]>).map(([key, item]) => {
            const active = selectedPlan === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSelectedPlan(key);
                  setAmountSubmitted(String(item.amount));
                }}
                className={`rounded-[28px] border p-5 text-left transition ${
                  active
                    ? "border-sky-300 bg-sky-50 shadow-[0_16px_38px_rgba(31,116,201,0.14)]"
                    : "border-[var(--moovu-border)] bg-white shadow-sm hover:border-sky-200"
                }`}
              >
                <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">
                  {item.label}
                </div>
                <div className="mt-3 text-4xl font-black">{money(item.amount)}</div>
                <p className="mt-2 text-sm text-slate-600">
                  {item.days} day{item.days === 1 ? "" : "s"} driver access.
                </p>
                {active ? <div className="mt-4"><StatusBadge status="selected" /></div> : null}
              </button>
            );
          })}
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="moovu-card p-5 sm:p-6">
            <h2 className="text-xl font-black">Payment details</h2>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Selected plan</div>
                <div className="mt-1 text-lg font-black">{selectedPlanDetails.label}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Exact amount</div>
                <div className="mt-1 text-lg font-black">{money(selectedPlanDetails.amount)}</div>
              </div>
              <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-100">
                <div className="font-bold">Bank details</div>
                <div className="mt-2 grid gap-2 text-slate-700">
                  <div>{BANK_DETAILS.bankName}</div>
                  <div>{BANK_DETAILS.accountName}</div>
                  <div>{BANK_DETAILS.accountNumber}</div>
                  <div>Branch {BANK_DETAILS.branchCode}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="moovu-card p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">Submit subscription POP</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Upload proof after paying. Admin approval activates or extends your subscription.
                </p>
              </div>
              <StatusBadge status={pendingRequest ? pendingRequest.status : "ready"} />
            </div>

            {pendingRequest ? (
              <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <div className="font-black">Review in progress</div>
                <p className="mt-2">
                  Reference {pendingRequest.payment_reference} is waiting for MOOVU admin review.
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
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
                  accept="image/*,.pdf"
                  onClick={() => void requestNativeCameraPermissions()}
                  onChange={(event) => setPopFile(event.target.files?.[0] ?? null)}
                />
                <textarea
                  className="moovu-input min-h-24 resize-none"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Optional note for admin"
                />
                <label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>I confirm I paid the selected subscription amount and uploaded the correct POP.</span>
                </label>
                <button
                  type="button"
                  className="moovu-btn moovu-btn-primary w-full"
                  disabled={busy}
                  onClick={() => void submitSubscriptionPayment()}
                >
                  {busy ? "Submitting..." : `Submit ${selectedPlanDetails.label} POP`}
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="moovu-card p-5 sm:p-6">
            <h2 className="text-xl font-black">Subscription requests</h2>
            <div className="mt-4 space-y-3">
              {requests.length === 0 ? (
                <EmptyState title="No subscription requests" description="Your submitted subscription POPs will appear here." />
              ) : (
                requests.map((row) => (
                  <div key={row.id} className="moovu-card-interactive p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-black">{row.payment_reference}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {planLabel(row.subscription_plan)} · {money(row.amount_submitted)}
                        </div>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                      <span>Submitted {displayDate(row.submitted_at)}</span>
                      <Link className="font-bold text-[var(--moovu-primary)]" href={`/driver/payment-receipts/${row.id}`}>
                        Open receipt
                      </Link>
                    </div>
                    {row.review_note ? <div className="mt-3 text-sm text-slate-700">Admin note: {row.review_note}</div> : null}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="moovu-card p-5 sm:p-6">
            <h2 className="text-xl font-black">Approved history</h2>
            <div className="mt-4 space-y-3">
              {payments.length === 0 && approvedRequests.length === 0 && rejectedRequests.length === 0 ? (
                <EmptyState title="No payment history" description="Approved and reviewed subscription payments will appear here." />
              ) : (
                <>
                  {payments.map((row) => (
                    <div key={row.id} className="rounded-3xl border border-[var(--moovu-border)] bg-white p-4">
                      <div className="font-black">{money(row.amount_paid)} · {row.payment_method}</div>
                      <div className="mt-1 text-sm text-slate-600">{row.reference ?? "--"}</div>
                      <div className="mt-2 text-xs text-slate-500">{displayDate(row.created_at)}</div>
                    </div>
                  ))}
                  {rejectedRequests.map((row) => (
                    <div key={row.id} className="rounded-3xl border border-red-100 bg-red-50 p-4">
                      <div className="font-black text-red-900">Rejected · {row.payment_reference}</div>
                      <div className="mt-1 text-sm text-red-800">{row.review_note ?? "No admin note."}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <DriverBottomNav />
    </main>
  );
}
