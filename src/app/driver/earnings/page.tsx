"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
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
    loadData();
  }, []);

  const driverName = useMemo(() => {
    return `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver";
  }, [driver]);

  const commissionDue = Number(wallet?.balance_due ?? 0);
  const subscriptionSelectedPrice = PLAN_PRICES[selectedPlan];
  const totalDue = modalType === "combined" ? commissionDue + subscriptionSelectedPrice : 0;

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
    return <main className="p-6 text-black">Loading MOOVU payments...</main>;
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">MOOVU Driver</div>
            <h1 className="text-3xl font-semibold mt-1">MOOVU Payments</h1>
            <p className="text-gray-700 mt-2">
              Pay subscriptions, commission balances, or both in one place.
            </p>
          </div>

          <Link href="/driver" className="border rounded-xl px-4 py-2 bg-white">
            Back to Dashboard
          </Link>
        </div>

        <section className="grid md:grid-cols-4 gap-4">
          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Subscription Status</div>
            <div className="text-2xl font-semibold mt-2">{driver?.subscription_status ?? "—"}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Current Plan</div>
            <div className="text-2xl font-semibold mt-2">{driver?.subscription_plan ?? "—"}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Expires</div>
            <div className="text-lg font-semibold mt-2">
              {driver?.subscription_expires_at
                ? new Date(driver.subscription_expires_at).toLocaleString()
                : "—"}
            </div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Commission Due</div>
            <div className="text-2xl font-semibold mt-2">{money(commissionDue)}</div>
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Choose What You Want to Pay</h2>

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

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Submitted Payment Requests</h2>

          {paymentRequests.length === 0 ? (
            <div>No payment requests submitted yet.</div>
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
                      <div className="font-medium">{row.subscription_plan ?? "—"}</div>
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
                      <div className="font-medium">{row.status}</div>
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
          <div className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Commission Payment History</h2>

            {settlements.length === 0 ? (
              <div>No commission payments recorded yet.</div>
            ) : (
              <div className="space-y-3">
                {settlements.map((row) => (
                  <div key={row.id} className="border rounded-2xl p-4">
                    <div>{money(row.amount_paid)} • {row.payment_method}</div>
                    <div className="text-sm text-gray-500 mt-1">{row.reference || "—"}</div>
                    <div className="text-xs text-gray-500 mt-2">{new Date(row.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Subscription Payment History</h2>

            {subscriptionPayments.length === 0 ? (
              <div>No subscription payments recorded yet.</div>
            ) : (
              <div className="space-y-3">
                {subscriptionPayments.map((row) => (
                  <div key={row.id} className="border rounded-2xl p-4">
                    <div>{money(row.amount_paid)} • {row.payment_method}</div>
                    <div className="text-sm text-gray-500 mt-1">{row.reference || "—"}</div>
                    <div className="text-xs text-gray-500 mt-2">{new Date(row.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
                      <div className="text-sm text-gray-500">Pickup</div>
                      <div className="font-medium">{trip.pickup_address || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Dropoff</div>
                      <div className="font-medium">{trip.dropoff_address || "—"}</div>
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
                      <div className="font-medium">
                        {(trip.completed_at ?? trip.created_at)
                          ? new Date(trip.completed_at ?? trip.created_at!).toLocaleString()
                          : "—"}
                      </div>
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