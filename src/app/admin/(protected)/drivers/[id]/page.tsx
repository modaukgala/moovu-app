"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";

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
  subscription_status?: string | null;
  subscription_plan?: string | null;
  subscription_expires_at?: string | null;
  subscription_amount_due?: number | null;
  subscription_last_paid_at?: string | null;
  subscription_last_payment_amount?: number | null;
  created_at?: string | null;
  is_deleted?: boolean | null;
  deleted_at?: string | null;
  delete_mode?: string | null;
  deleted_reason?: string | null;
};

type SubscriptionPayment = {
  id: string;
  amount_paid: number;
  payment_method: string;
  reference: string | null;
  note: string | null;
  created_at: string | null;
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

function money(v: number | null | undefined) {
  return `R${Number(v ?? 0).toFixed(2)}`;
}

export default function AdminDriverProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const driverId = params.id;

  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [subscriptionPayments, setSubscriptionPayments] = useState<SubscriptionPayment[]>([]);
  const [subscriptionRequests, setSubscriptionRequests] = useState<SubscriptionRequest[]>([]);
  const [busy, setBusy] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [planType, setPlanType] = useState<"day" | "week" | "month">("month");
  const [amountPaid, setAmountPaid] = useState("300");
  const [paymentMethod, setPaymentMethod] = useState("eft");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

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

    const profileRes = await fetch(`/api/admin/driver-profile?driverId=${encodeURIComponent(driverId)}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const profileJson = await profileRes.json().catch(() => null);

    if (!profileJson?.ok) {
      setBusy(false);
      setMsg(profileJson?.error || "Failed to load driver profile.");
      return;
    }

    setProfile(profileJson.profile ?? null);
    setSubscriptionPayments(profileJson.subscription_payments ?? []);
    setSubscriptionRequests(profileJson.subscription_requests ?? []);
    setBusy(false);
  }

  async function activateSubscription(requestId?: string) {
    if (!amountPaid || Number(amountPaid) <= 0) {
      setMsg("Enter a valid payment amount.");
      return;
    }

    setActionBusy(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setActionBusy(false);
      setMsg("Missing access token.");
      return;
    }

    const res = await fetch("/api/admin/driver-subscription-activate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        driverId,
        planType,
        amountPaid: Number(amountPaid),
        paymentMethod,
        reference,
        note,
        requestId,
      }),
    });

    const json = await res.json().catch(() => null);
    setActionBusy(false);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to activate subscription.");
      return;
    }

    setMsg(json?.message || "Subscription activated.");
    setReference("");
    setNote("");
    await loadAll();
  }

  useEffect(() => {
    loadAll();
  }, [driverId]);

  useEffect(() => {
    setAmountPaid(String(PLAN_PRICES[planType]));
  }, [planType]);

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
          {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
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
              {profile.phone ?? "—"} • sub status: {profile.subscription_status ?? "—"} • plan: {profile.subscription_plan ?? "—"}
            </p>
          </div>

          <Link href="/admin/applications" className="inline-flex border rounded-xl px-4 py-2 bg-white">
            Back
          </Link>
        </div>

        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

        <section className="grid md:grid-cols-4 gap-4">
          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Subscription Status</div>
            <div className="text-2xl font-semibold mt-2">{profile.subscription_status ?? "—"}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Current Plan</div>
            <div className="text-2xl font-semibold mt-2">{profile.subscription_plan ?? "—"}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Expires</div>
            <div className="text-lg font-semibold mt-2">
              {profile.subscription_expires_at
                ? new Date(profile.subscription_expires_at).toLocaleString()
                : "—"}
            </div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Last Payment</div>
            <div className="text-lg font-semibold mt-2">
              {profile.subscription_last_paid_at
                ? money(profile.subscription_last_payment_amount)
                : "—"}
            </div>
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-2xl font-semibold">Confirm Payment & Activate Prepaid Subscription</h2>

          <div className="grid md:grid-cols-4 gap-4">
            <select
              className="border rounded-xl p-3"
              value={planType}
              onChange={(e) => setPlanType(e.target.value as "day" | "week" | "month")}
            >
              <option value="day">Day Plan</option>
              <option value="week">Week Plan</option>
              <option value="month">Month Plan</option>
            </select>

            <input
              className="border rounded-xl p-3"
              type="number"
              min="0"
              step="0.01"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              placeholder="Amount paid"
            />

            <select
              className="border rounded-xl p-3"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="eft">EFT</option>
              <option value="transfer">Transfer</option>
              <option value="deposit">Deposit</option>
              <option value="cash">Cash</option>
            </select>

            <input
              className="border rounded-xl p-3"
              placeholder="Reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <input
            className="border rounded-xl p-3 w-full"
            placeholder="Optional note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="border rounded-2xl p-4 space-y-2">
            <div><span className="text-gray-500">Bank:</span> {BANK_DETAILS.bankName}</div>
            <div><span className="text-gray-500">Account Name:</span> {BANK_DETAILS.accountName}</div>
            <div><span className="text-gray-500">Account Number:</span> {BANK_DETAILS.accountNumber}</div>
            <div><span className="text-gray-500">Branch Code:</span> {BANK_DETAILS.branchCode}</div>
          </div>

          <button
            onClick={() => activateSubscription()}
            disabled={actionBusy}
            className="rounded-xl px-4 py-3 text-white"
            style={{ background: "var(--moovu-primary)" }}
          >
            {actionBusy ? "Activating..." : "Confirm Payment & Activate"}
          </button>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-2xl font-semibold">Recent Subscription Requests</h2>

          {subscriptionRequests.length === 0 ? (
            <div>No subscription requests yet.</div>
          ) : (
            <div className="space-y-3">
              {subscriptionRequests.map((row) => (
                <div key={row.id} className="border rounded-xl p-4">
                  <div className="grid md:grid-cols-5 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Plan</div>
                      <div className="font-medium">{row.plan_type}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Expected</div>
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
                      <div className="text-sm text-gray-500">Action</div>
                      {row.status === "pending" ? (
                        <button
                          onClick={() => {
                            setPlanType(row.plan_type as "day" | "week" | "month");
                            setAmountPaid(String(row.amount_expected));
                            setReference(row.payment_reference);
                            activateSubscription(row.id);
                          }}
                          disabled={actionBusy}
                          className="border rounded-xl px-3 py-2 bg-white"
                        >
                          Confirm & Activate
                        </button>
                      ) : (
                        <div className="font-medium">Done</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-2xl font-semibold">Subscription Payment History</h2>

          {subscriptionPayments.length === 0 ? (
            <div>No subscription payments recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {subscriptionPayments.map((row) => (
                <div key={row.id} className="border rounded-xl p-4">
                  <div className="grid md:grid-cols-4 gap-4">
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
                      <div className="font-medium">{row.reference || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Date</div>
                      <div className="font-medium">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
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