"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";
import { waLinkZA } from "@/lib/whatsapp";

type Wallet = {
  balance_due: number | null;
  total_commission: number | null;
  total_driver_net: number | null;
  total_trips_completed: number | null;
  last_payment_at: string | null;
  last_payment_amount: number | null;
  account_status: string | null;
};

type DriverInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
};

type SubscriptionPayment = {
  id: string;
  amount_paid: number;
  payment_method: string;
  reference: string | null;
  note: string | null;
  created_at: string;
};

type SubscriptionRequest = {
  id: string;
  plan_type: string;
  amount_expected: number;
  payment_reference: string;
  note: string | null;
  status: string;
  created_at: string;
  confirmed_at: string | null;
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
  status: string | null;
};

const PLAN_PRICES = {
  day: 20,
  week: 100,
  month: 300,
} as const;

const BANK_DETAILS = {
  bankName: "NEDBANK",
  accountName: "Current Account",
  accountNumber: "2129562558",
  branchCode: "198765",
};

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

export default function DriverEarningsPage() {
  const [loading, setLoading] = useState(true);
  const [requestBusy, setRequestBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [subscriptionPayments, setSubscriptionPayments] = useState<SubscriptionPayment[]>([]);
  const [subscriptionRequests, setSubscriptionRequests] = useState<SubscriptionRequest[]>([]);
  const [trips, setTrips] = useState<CompletedTrip[]>([]);
  const [showBank, setShowBank] = useState<false | "day" | "week" | "month">(false);

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
    setDriver(json.earnings?.driver ?? null);
    setSubscriptionPayments(json.earnings?.subscription_payments ?? []);
    setSubscriptionRequests(json.earnings?.subscription_requests ?? []);
    setTrips(json.earnings?.recent_completed_trips ?? []);
    setLoading(false);
  }

  async function requestSubscription(planType: "day" | "week" | "month") {
    setRequestBusy(true);
    setMsg(null);

    const token = await getToken();
    if (!token) {
      setMsg("You are not logged in.");
      setRequestBusy(false);
      return;
    }

    const res = await fetch("/api/driver/subscription-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        planType,
      }),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to create subscription request.");
      setRequestBusy(false);
      return;
    }

    setMsg(
      `${json?.message || "Subscription request created."} Reference: ${json?.paymentReference}`
    );
    await loadData();
    setShowBank(planType);
    setRequestBusy(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const driverName = useMemo(() => {
    return `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver";
  }, [driver]);

  const currentPlanReference = useMemo(() => {
    if (!showBank || !driver?.id) return "";
    return `SUB-${driver.id.slice(0, 6).toUpperCase()}-${showBank.toUpperCase()}`;
  }, [showBank, driver?.id]);

  const whatsappPlanReminder = useMemo(() => {
    if (!showBank || !driver?.phone) return "";
    return waLinkZA(
      driver.phone,
      `Hi MOOVU, I want to buy a ${showBank} subscription for ${money(
        PLAN_PRICES[showBank]
      )}. I have used reference ${currentPlanReference}.`
    );
  }, [showBank, driver?.phone, currentPlanReference]);

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
            <h1 className="text-3xl font-semibold mt-1">Earnings & Prepaid Subscription</h1>
            <p className="text-gray-700 mt-2">
              Buy a prepaid subscription, then admin confirms your payment and activates access.
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
            <div className="text-sm text-gray-600">Trip Balance Due</div>
            <div className="text-2xl font-semibold mt-2">{money(wallet?.balance_due)}</div>
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Buy Prepaid Subscription</h2>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="border rounded-2xl p-5 space-y-3">
              <div className="text-sm text-gray-500">Day Plan</div>
              <div className="text-3xl font-semibold">{money(PLAN_PRICES.day)}</div>
              <button
                onClick={() => requestSubscription("day")}
                disabled={requestBusy}
                className="rounded-xl px-4 py-3 text-white w-full"
                style={{ background: "var(--moovu-primary)" }}
              >
                {requestBusy ? "Processing..." : "Buy Day Plan"}
              </button>
            </div>

            <div className="border rounded-2xl p-5 space-y-3">
              <div className="text-sm text-gray-500">Week Plan</div>
              <div className="text-3xl font-semibold">{money(PLAN_PRICES.week)}</div>
              <button
                onClick={() => requestSubscription("week")}
                disabled={requestBusy}
                className="rounded-xl px-4 py-3 text-white w-full"
                style={{ background: "var(--moovu-primary)" }}
              >
                {requestBusy ? "Processing..." : "Buy Week Plan"}
              </button>
            </div>

            <div className="border rounded-2xl p-5 space-y-3">
              <div className="text-sm text-gray-500">Month Plan</div>
              <div className="text-3xl font-semibold">{money(PLAN_PRICES.month)}</div>
              <button
                onClick={() => requestSubscription("month")}
                disabled={requestBusy}
                className="rounded-xl px-4 py-3 text-white w-full"
                style={{ background: "var(--moovu-primary)" }}
              >
                {requestBusy ? "Processing..." : "Buy Month Plan"}
              </button>
            </div>
          </div>

          {showBank && (
            <div className="border rounded-2xl p-4 space-y-2">
              <div><span className="text-gray-500">Bank:</span> {BANK_DETAILS.bankName}</div>
              <div><span className="text-gray-500">Account Name:</span> {BANK_DETAILS.accountName}</div>
              <div><span className="text-gray-500">Account Number:</span> {BANK_DETAILS.accountNumber}</div>
              <div><span className="text-gray-500">Branch Code:</span> {BANK_DETAILS.branchCode}</div>
              <div><span className="text-gray-500">Plan:</span> {showBank}</div>
              <div><span className="text-gray-500">Amount:</span> {money(PLAN_PRICES[showBank])}</div>
              <div><span className="text-gray-500">Reference:</span> {currentPlanReference}</div>

              {whatsappPlanReminder ? (
                <a
                  href={whatsappPlanReminder}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex mt-3 border rounded-xl px-4 py-2 bg-white"
                >
                  Notify Admin on WhatsApp
                </a>
              ) : null}
            </div>
          )}
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Recent Subscription Requests</h2>

          {subscriptionRequests.length === 0 ? (
            <div>No subscription requests yet.</div>
          ) : (
            <div className="space-y-3">
              {subscriptionRequests.map((row) => (
                <div key={row.id} className="border rounded-2xl p-4">
                  <div className="grid md:grid-cols-5 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Plan</div>
                      <div className="font-medium">{row.plan_type}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Amount</div>
                      <div className="font-medium">{money(row.amount_expected)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Reference</div>
                      <div className="font-medium">{row.payment_reference}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Status</div>
                      <div className="font-medium">{row.status}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Created</div>
                      <div className="font-medium">{new Date(row.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Subscription Payment History</h2>

          {subscriptionPayments.length === 0 ? (
            <div>No subscription payments recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {subscriptionPayments.map((row) => (
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