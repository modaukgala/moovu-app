"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
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
  phone: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
  subscription_amount_due: number | null;
};

type PaymentRequest = {
  id: string;
  payment_type: "subscription" | "commission" | "combined";
  subscription_plan: "day" | "week" | "month" | null;
  amount_expected: number;
  amount_submitted: number;
  payment_reference: string;
  note: string | null;
  pop_file_url: string | null;
  status: string;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};

type Settlement = {
  id: string;
  amount_paid: number;
  payment_method: string;
  reference: string | null;
  note: string | null;
  created_at: string;
};

type SubscriptionPayment = {
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
  completed_at?: string | null;
};

const PLAN_PRICES = {
  day: 45,
  week: 100,
  month: 250,
} as const;

const BANK_DETAILS = {
  bankName: "NEDBANK",
  accountName: "Current Account",
  accountNumber: "2129562558",
  branchCode: "198765",
};

type ModalType = "subscription" | "commission" | "combined" | null;
type PlanType = "day" | "week" | "month";

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayValue(value: string | null | undefined) {
  return value?.trim() || "--";
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function tripDate(trip: CompletedTrip) {
  return trip.completed_at || trip.created_at || "";
}

export default function DriverEarningsPage() {
  const [loading, setLoading] = useState(true);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [subscriptionPayments, setSubscriptionPayments] = useState<SubscriptionPayment[]>([]);
  const [trips, setTrips] = useState<CompletedTrip[]>([]);

  const [modalType, setModalType] = useState<ModalType>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanType>("month");
  const [amountSubmitted, setAmountSubmitted] = useState("");
  const [note, setNote] = useState("");
  const [popFile, setPopFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);

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
      setMsg(json?.error || "Failed to load MOOVU payments.");
      setLoading(false);
      return;
    }

    setWallet(json.earnings?.wallet ?? null);
    setDriver(json.earnings?.driver ?? null);
    setPaymentRequests(json.earnings?.payment_requests ?? []);
    setSettlements(json.earnings?.settlements ?? []);
    setSubscriptionPayments(json.earnings?.subscription_payments ?? []);
    setTrips(json.earnings?.recent_completed_trips ?? []);
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const driverName = useMemo(() => {
    return `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver";
  }, [driver]);

  const commissionDue = Number(wallet?.balance_due ?? 0);
  const subscriptionSelectedPrice = PLAN_PRICES[selectedPlan];
  const totalDue = modalType === "combined" ? commissionDue + subscriptionSelectedPrice : 0;

  const now = useMemo(() => new Date(), []);
  const todayStart = useMemo(
    () => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
    [now],
  );
  const weekStart = useMemo(() => todayStart - 6 * 24 * 60 * 60 * 1000, [todayStart]);
  const monthStart = useMemo(
    () => new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    [now],
  );

  const earningsSummary = useMemo(() => {
    return trips.reduce(
      (summary, trip) => {
        const earned = Number(trip.driver_net_earnings ?? trip.fare_amount ?? 0);
        const dateMs = tripDate(trip) ? new Date(tripDate(trip)).getTime() : 0;

        summary.total += earned;
        if (dateMs >= todayStart) summary.today += earned;
        if (dateMs >= weekStart) summary.week += earned;
        if (dateMs >= monthStart) summary.month += earned;
        return summary;
      },
      { today: 0, week: 0, month: 0, total: 0 },
    );
  }, [monthStart, todayStart, trips, weekStart]);

  const reference = useMemo(() => {
    if (!driver?.id) return "";
    const prefix =
      modalType === "subscription"
        ? "SUB"
        : modalType === "commission"
        ? "COMM"
        : modalType === "combined"
        ? "ALL"
        : "PAY";

    const parts = [prefix, driver.id.slice(0, 6).toUpperCase()];
    if (modalType === "subscription" || modalType === "combined") {
      parts.push(selectedPlan.toUpperCase());
    }
    return parts.join("-");
  }, [driver?.id, modalType, selectedPlan]);

  const expectedAmount = useMemo(() => {
    if (modalType === "subscription") return subscriptionSelectedPrice;
    if (modalType === "commission") return commissionDue;
    if (modalType === "combined") return totalDue;
    return 0;
  }, [modalType, subscriptionSelectedPrice, commissionDue, totalDue]);

  function openPaymentModal(type: ModalType) {
    setModalType(type);
    setConfirmed(false);
    setNote("");
    setPopFile(null);
    if (type === "subscription") {
      setAmountSubmitted(String(subscriptionSelectedPrice));
    } else if (type === "commission") {
      setAmountSubmitted(String(commissionDue));
    } else if (type === "combined") {
      setAmountSubmitted(String(commissionDue + subscriptionSelectedPrice));
    } else {
      setAmountSubmitted("");
    }
  }

  function closePaymentModal() {
    setModalType(null);
    setConfirmed(false);
    setNote("");
    setPopFile(null);
    setAmountSubmitted("");
  }

  async function submitPaymentRequest() {
    if (!modalType) return;

    if (!confirmed) {
      setMsg("Please confirm that you are submitting the correct payment.");
      return;
    }

    if (!amountSubmitted || Number(amountSubmitted) <= 0) {
      setMsg("Please enter the amount paid.");
      return;
    }

    setSubmitBusy(true);
    setMsg(null);

    const token = await getToken();
    if (!token) {
      setSubmitBusy(false);
      setMsg("You are not logged in.");
      return;
    }

    const formData = new FormData();
    formData.append("paymentType", modalType);
    if (modalType === "subscription" || modalType === "combined") {
      formData.append("subscriptionPlan", selectedPlan);
    }
    formData.append("amountSubmitted", amountSubmitted);
    formData.append("note", note);
    if (popFile) {
      formData.append("pop", popFile);
    }

    const res = await fetch("/api/driver/payment-request", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setSubmitBusy(false);
      setMsg(json?.error || "Failed to submit payment.");
      return;
    }

    setSubmitBusy(false);
    setMsg(json?.message || "Payment submitted successfully.");
    closePaymentModal();
    await loadData();
  }

  if (loading) {
    return (
      <LoadingState
        title="Loading driver earnings"
        description="Preparing earnings, commission balance, subscriptions, and payment history."
      />
    );
  }

  return (
    <main className="moovu-page text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-shell space-y-6">
        <div className="moovu-card p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="moovu-section-title">MOOVU Driver</div>
            <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">Earnings and payments</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Pay subscriptions, commission balances, or both in one place.
            </p>
          </div>

          <Link href="/driver" className="moovu-btn moovu-btn-secondary">
            Back to Dashboard
          </Link>
          </div>
        </div>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Today" value={money(earningsSummary.today)} helper="Recent completed trips" />
          <MetricCard label="This week" value={money(earningsSummary.week)} helper="Last 7 days" />
          <MetricCard label="This month" value={money(earningsSummary.month)} helper="Current month" />
          <MetricCard label="Total earned" value={money(wallet?.total_driver_net ?? earningsSummary.total)} helper={`${wallet?.total_trips_completed ?? trips.length} completed trips`} tone="primary" />
          <MetricCard label="Commission owed" value={money(commissionDue)} helper="Payable to MOOVU" tone={commissionDue > 0 ? "warning" : "success"} />
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="moovu-card p-5">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Subscription</div>
            <div className="mt-2"><StatusBadge status={driver?.subscription_status} /></div>
          </div>
          <div className="moovu-card p-5">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Current plan</div>
            <div className="mt-2 text-xl font-black text-slate-950">{displayValue(driver?.subscription_plan)}</div>
          </div>
          <div className="moovu-card p-5">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Expires</div>
            <div className="mt-2 text-sm font-black text-slate-950">
              {displayDate(driver?.subscription_expires_at)}
            </div>
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Choose what you want to pay</h2>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="border rounded-2xl p-5 space-y-4">
              <div className="text-sm text-gray-500">Subscription Payment</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  className={`border rounded-xl px-3 py-2 ${selectedPlan === "day" ? "font-semibold" : ""}`}
                  onClick={() => setSelectedPlan("day")}
                >
                  Day {money(45)}
                </button>
                <button
                  className={`border rounded-xl px-3 py-2 ${selectedPlan === "week" ? "font-semibold" : ""}`}
                  onClick={() => setSelectedPlan("week")}
                >
                  Week {money(100)}
                </button>
                <button
                  className={`border rounded-xl px-3 py-2 ${selectedPlan === "month" ? "font-semibold" : ""}`}
                  onClick={() => setSelectedPlan("month")}
                >
                  Month {money(250)}
                </button>
              </div>
              <div className="text-xl font-semibold">{money(subscriptionSelectedPrice)}</div>
              <button
                onClick={() => openPaymentModal("subscription")}
                className="rounded-xl px-4 py-3 text-white w-full"
                style={{ background: "var(--moovu-primary)" }}
              >
                Pay Subscription
              </button>
            </div>

            <div className="border rounded-2xl p-5 space-y-4">
              <div className="text-sm text-gray-500">Commission Payment</div>
              <div className="text-xl font-semibold">{money(commissionDue)}</div>
              <button
                onClick={() => openPaymentModal("commission")}
                className="rounded-xl px-4 py-3 text-white w-full"
                style={{ background: "var(--moovu-primary)" }}
              >
                Pay Commission
              </button>
            </div>

            <div className="border rounded-2xl p-5 space-y-4">
              <div className="text-sm text-gray-500">Pay Total Due</div>
              <div className="text-xl font-semibold">{money(commissionDue + subscriptionSelectedPrice)}</div>
              <button
                onClick={() => openPaymentModal("combined")}
                className="rounded-xl px-4 py-3 text-white w-full"
                style={{ background: "var(--moovu-primary)" }}
              >
                Pay Total Due
              </button>
            </div>
          </div>
        </section>

        {modalType && (
          <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Confirm Payment</h2>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="border rounded-2xl p-4 space-y-2">
                <div><span className="text-gray-500">Driver:</span> {driverName}</div>
                <div><span className="text-gray-500">Payment Type:</span> {modalType}</div>
                {(modalType === "subscription" || modalType === "combined") && (
                  <div><span className="text-gray-500">Plan:</span> {selectedPlan}</div>
                )}
                <div><span className="text-gray-500">Expected Amount:</span> {money(expectedAmount)}</div>
                <div><span className="text-gray-500">Reference:</span> {reference}</div>
              </div>

              <div className="border rounded-2xl p-4 space-y-2">
                <div><span className="text-gray-500">Bank:</span> {BANK_DETAILS.bankName}</div>
                <div><span className="text-gray-500">Account Name:</span> {BANK_DETAILS.accountName}</div>
                <div><span className="text-gray-500">Account Number:</span> {BANK_DETAILS.accountNumber}</div>
                <div><span className="text-gray-500">Branch Code:</span> {BANK_DETAILS.branchCode}</div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <input
                className="border rounded-xl p-3"
                type="number"
                min="0"
                step="0.01"
                value={amountSubmitted}
                onChange={(e) => setAmountSubmitted(e.target.value)}
                placeholder="Amount paid"
              />

              <input
                className="border rounded-xl p-3"
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                onChange={(e) => setPopFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <input
              className="border rounded-xl p-3 w-full"
              placeholder="Optional note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>I confirm that I have used the correct reference and amount.</span>
            </label>

            <div className="flex gap-3">
              <button
                onClick={closePaymentModal}
                className="border rounded-xl px-4 py-3 bg-white"
              >
                Cancel
              </button>

              <button
                onClick={submitPaymentRequest}
                disabled={submitBusy}
                className="rounded-xl px-4 py-3 text-white"
                style={{ background: "var(--moovu-primary)" }}
              >
                {submitBusy ? "Submitting..." : "I Have Paid"}
              </button>
            </div>
          </section>
        )}

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Submitted payment requests</h2>

          {paymentRequests.length === 0 ? (
            <EmptyState
              title="No payment requests yet"
              description="Submitted subscription and commission proof of payment requests will appear here."
            />
          ) : (
            <div className="space-y-3">
              {paymentRequests.map((row) => (
                <div key={row.id} className="border rounded-2xl p-4">
                  <div className="grid md:grid-cols-6 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Type</div>
                      <div className="font-medium">{row.payment_type}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Plan</div>
                      <div className="font-medium">{displayValue(row.subscription_plan)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Expected</div>
                      <div className="font-medium">{money(row.amount_expected)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Submitted</div>
                      <div className="font-medium">{money(row.amount_submitted)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Reference</div>
                      <div className="font-medium">{row.payment_reference}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Status</div>
                      <StatusBadge status={row.status} />
                    </div>
                  </div>

                  {row.pop_file_url && (
                    <div className="mt-3">
                      <a
                        href={row.pop_file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="border rounded-xl px-3 py-2 inline-flex bg-white"
                      >
                        View POP
                      </a>
                    </div>
                  )}

                  {row.review_note && (
                    <div className="mt-3 text-sm text-gray-700">
                      Review note: {row.review_note}
                    </div>
                  )}

                  <div className="text-xs text-gray-500 mt-3">
                    Submitted: {new Date(row.submitted_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid lg:grid-cols-2 gap-6">
          <div className="moovu-card p-5 sm:p-6 space-y-4">
            <h2 className="text-xl font-black text-slate-950">Commission payment history</h2>

            {settlements.length === 0 ? (
              <EmptyState
                title="No commission payments"
                description="Approved commission settlement records will appear here."
              />
            ) : (
              <div className="space-y-3">
                {settlements.map((row) => (
                  <div key={row.id} className="border rounded-2xl p-4">
                    <div>{money(row.amount_paid)} - {row.payment_method}</div>
                    <div className="text-sm text-gray-500 mt-1">{displayValue(row.reference)}</div>
                    <div className="text-xs text-gray-500 mt-2">{displayDate(row.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="moovu-card p-5 sm:p-6 space-y-4">
            <h2 className="text-xl font-black text-slate-950">Subscription payment history</h2>

            {subscriptionPayments.length === 0 ? (
              <EmptyState
                title="No subscription payments"
                description="Approved subscription payments will appear here."
              />
            ) : (
              <div className="space-y-3">
                {subscriptionPayments.map((row) => (
                  <div key={row.id} className="border rounded-2xl p-4">
                    <div>{money(row.amount_paid)} - {row.payment_method}</div>
                    <div className="text-sm text-gray-500 mt-1">{displayValue(row.reference)}</div>
                    <div className="text-xs text-gray-500 mt-2">{displayDate(row.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Recent completed trips</h2>

          {trips.length === 0 ? (
            <EmptyState
              title="No completed trips"
              description="Completed trip earnings will appear here after your first finished ride."
            />
          ) : (
            <div className="space-y-3">
              {trips.map((trip) => (
                <div key={trip.id} className="border rounded-2xl p-4">
                  <div className="grid md:grid-cols-5 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Pickup</div>
                      <div className="font-medium">{displayValue(trip.pickup_address)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Dropoff</div>
                      <div className="font-medium">{displayValue(trip.dropoff_address)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Fare</div>
                      <div className="font-medium">{money(trip.fare_amount)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Commission</div>
                      <div className="font-medium">{money(trip.commission_amount)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Completed</div>
                      <div className="font-medium">{displayDate(trip.completed_at ?? trip.created_at)}</div>
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
