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

type CommissionRequest = {
  id: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string | null;
  payment_type: "subscription" | "commission" | "combined";
  amount_expected: number;
  amount_submitted: number;
  payment_reference: string;
  note: string | null;
  pop_file_url: string | null;
  status: string;
  review_note: string | null;
  submitted_at: string;
};

type SettlementDriver = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  status?: string | null;
  online?: boolean | null;
  driver?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  };
  wallet?: {
    balance_due: number;
    total_commission: number;
    total_paid: number;
    last_payment_at: string | null;
    last_payment_amount: number | null;
  };
  wallet_summary?: {
    balance_due: number;
    total_commission: number;
    total_driver_net?: number;
    total_trips_completed?: number;
    total_paid: number;
    last_payment_at: string | null;
    last_payment_amount: number | null;
    account_status?: string | null;
  };
};

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function driverName(row: SettlementDriver) {
  const firstName = row.driver?.first_name ?? row.first_name ?? "";
  const lastName = row.driver?.last_name ?? row.last_name ?? "";
  return `${firstName} ${lastName}`.trim() || row.driver?.id || row.id || "Driver";
}

function driverId(row: SettlementDriver) {
  return row.driver?.id || row.id || "";
}

function driverPhone(row: SettlementDriver) {
  return row.driver?.phone ?? row.phone ?? null;
}

function wallet(row: SettlementDriver) {
  return row.wallet_summary ?? row.wallet ?? {
    balance_due: 0,
    total_commission: 0,
    total_paid: 0,
    last_payment_at: null,
    last_payment_amount: null,
  };
}

function standing(balanceDue: number, hasPending: boolean) {
  if (hasPending) return "pending review";
  if (balanceDue >= DRIVER_COMMISSION_LOCK_LIMIT) return "locked";
  if (balanceDue > 0) return "warning";
  return "good standing";
}

export default function AdminCommissionPaymentsPage() {
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [requests, setRequests] = useState<CommissionRequest[]>([]);
  const [drivers, setDrivers] = useState<SettlementDriver[]>([]);
  const [reviewDraft, setReviewDraft] = useState<{
    requestId: string;
    action: "approve" | "reject" | "waiting";
    note: string;
  } | null>(null);

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

    const [reviewsRes, settlementsRes] = await Promise.all([
      fetch("/api/admin/payment-reviews?status=all", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch("/api/admin/settlements", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    const reviewsJson = await reviewsRes.json().catch(() => null);
    const settlementsJson = await settlementsRes.json().catch(() => null);

    if (!reviewsJson?.ok) {
      setMsg(reviewsJson?.error || "Failed to load commission payment reviews.");
      setLoading(false);
      return;
    }

    if (!settlementsJson?.ok) {
      setMsg(settlementsJson?.error || "Failed to load commission balances.");
      setLoading(false);
      return;
    }

    setRequests(
      (reviewsJson.requests ?? []).filter(
        (row: CommissionRequest) => row.payment_type === "commission"
      )
    );
    setDrivers(settlementsJson.drivers ?? []);
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  async function reviewRequest(
    requestId: string,
    action: "approve" | "reject" | "waiting",
    reviewNote: string,
  ) {
    setBusyId(requestId);
    setMsg(null);

    const token = await getToken();
    if (!token) {
      setBusyId(null);
      setMsg("You are not logged in.");
      return;
    }

    const res = await fetch("/api/admin/payment-reviews", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestId, action, reviewNote }),
    });

    const json = await res.json().catch(() => null);
    setBusyId(null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to review commission payment.");
      return;
    }

    setReviewDraft(null);
    setMsg(json?.message || "Commission payment updated.");
    await loadData();
  }

  const pendingRequests = requests.filter((row) =>
    ["pending_payment_review", "waiting_confirmation"].includes(row.status)
  );
  const pendingByDriver = useMemo(
    () => new Set(pendingRequests.map((row) => row.driver_id)),
    [pendingRequests]
  );
  const driversWithBalances = drivers.filter((row) => Number(wallet(row).balance_due ?? 0) > 0);
  const totalOwed = drivers.reduce((sum, row) => sum + Number(wallet(row).balance_due ?? 0), 0);
  const totalCommissionEarned = drivers.reduce(
    (sum, row) => sum + Number(wallet(row).total_commission ?? 0),
    0
  );
  const totalPaid = drivers.reduce((sum, row) => sum + Number(wallet(row).total_paid ?? 0), 0);
  const lockedDrivers = drivers.filter(
    (row) => Number(wallet(row).balance_due ?? 0) >= DRIVER_COMMISSION_LOCK_LIMIT
  );
  const collectedThisMonth = drivers.reduce((sum, row) => {
    const driverWallet = wallet(row);
    const paidAt = driverWallet.last_payment_at ? new Date(driverWallet.last_payment_at) : null;
    const now = new Date();
    const inMonth = paidAt && paidAt.getMonth() === now.getMonth() && paidAt.getFullYear() === now.getFullYear();
    return sum + (inMonth ? Number(driverWallet.last_payment_amount ?? 0) : 0);
  }, 0);

  if (loading) {
    return (
      <LoadingState
        title="Loading commission payments"
        description="Preparing commission balances and pending driver POP reviews."
      />
    );
  }

  return (
    <main className="space-y-6 text-slate-950">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      {reviewDraft && (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <section className="w-full max-w-lg rounded-[30px] bg-white p-5 shadow-2xl">
            <div className="moovu-section-title">Commission review</div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              {reviewDraft.action === "approve"
                ? "Approve commission payment"
                : reviewDraft.action === "reject"
                  ? "Reject commission payment"
                  : "Waiting for bank confirmation"}
            </h2>
            <textarea
              value={reviewDraft.note}
              onChange={(event) =>
                setReviewDraft((current) =>
                  current ? { ...current, note: event.target.value } : current
                )
              }
              rows={4}
              className="moovu-input mt-4 resize-none"
              placeholder="Optional admin note"
            />
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button className="moovu-btn moovu-btn-secondary" onClick={() => setReviewDraft(null)}>
                Cancel
              </button>
              <button
                className="moovu-btn moovu-btn-primary"
                disabled={busyId === reviewDraft.requestId}
                onClick={() =>
                  void reviewRequest(reviewDraft.requestId, reviewDraft.action, reviewDraft.note.trim())
                }
              >
                {busyId === reviewDraft.requestId ? "Working..." : "Confirm"}
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="moovu-card overflow-hidden p-0">
        <div className="bg-gradient-to-br from-white via-sky-50 to-emerald-50 p-5 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="moovu-section-title">MOOVU Admin</div>
            <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
              Commission payments
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Review driver commission POPs, track locked accounts, and keep MOOVU collections clear from subscription revenue.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/subscriptions" className="moovu-btn moovu-btn-secondary">
              Subscription payments
            </Link>
            <button className="moovu-btn moovu-btn-primary" onClick={() => void loadData()}>
              Refresh
            </button>
          </div>
        </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-5">
        <MetricCard label="Total owed" value={money(totalOwed)} helper="Unpaid MOOVU commission" tone="warning" />
        <MetricCard label="Pending reviews" value={String(pendingRequests.length)} helper="Commission POPs" tone={pendingRequests.length ? "warning" : "default"} />
        <MetricCard label="Locked drivers" value={String(lockedDrivers.length)} helper={`At ${money(DRIVER_COMMISSION_LOCK_LIMIT)} or more`} tone={lockedDrivers.length ? "danger" : "success"} />
        <MetricCard label="Collected this month" value={money(collectedThisMonth)} helper="From latest wallet records" tone="success" />
        <MetricCard label="All-time collected" value={money(totalPaid)} helper={`${money(totalCommissionEarned)} generated`} tone="primary" />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="moovu-card-interactive p-5">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">Collection rule</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Drivers are blocked from going online once commission owed reaches {money(DRIVER_COMMISSION_LOCK_LIMIT)}.
          </p>
        </div>
        <div className="moovu-card-interactive p-5">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Review order</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Open proof, compare the bank reference, then approve, reject, or mark as waiting for bank confirmation.
          </p>
        </div>
        <div className="moovu-card-interactive p-5">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Clean split</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Commission reviews stay here. Subscription POPs stay under Subscriptions.
          </p>
        </div>
      </section>

      <section className="moovu-card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-slate-950">Pending commission reviews</h2>
          <StatusBadge status={pendingRequests.length ? "pending_payment_review" : "settled"} />
        </div>

        <div className="mt-4 space-y-4">
          {pendingRequests.length === 0 ? (
            <EmptyState title="No pending commission POPs" description="Commission payment submissions will appear here for admin review." />
          ) : (
            pendingRequests.map((row) => (
              <div key={row.id} className="moovu-card-interactive p-5">
                <div className="grid gap-4 md:grid-cols-5">
                  <div>
                    <div className="text-sm text-slate-500">Driver</div>
                    <div className="font-black text-slate-950">{row.driver_name}</div>
                    <div className="text-xs text-slate-500">{row.driver_phone || row.driver_id}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Expected</div>
                    <div className="font-semibold">{money(row.amount_expected)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Submitted</div>
                    <div className="font-semibold">{money(row.amount_submitted)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Reference</div>
                    <div className="font-semibold break-words">{row.payment_reference}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">POP</div>
                    {row.pop_file_url ? (
                      <a className="moovu-btn moovu-btn-secondary mt-1" href={row.pop_file_url} target="_blank" rel="noreferrer">
                        View proof
                      </a>
                    ) : (
                      <div className="text-sm font-semibold text-red-600">Missing POP</div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    className="moovu-btn moovu-btn-primary"
                    onClick={() => setReviewDraft({ requestId: row.id, action: "approve", note: "" })}
                    disabled={busyId === row.id}
                  >
                    Approve
                  </button>
                  <button
                    className="moovu-btn moovu-btn-secondary"
                    onClick={() => setReviewDraft({ requestId: row.id, action: "waiting", note: "" })}
                    disabled={busyId === row.id}
                  >
                    Waiting for bank
                  </button>
                  <button
                    className="moovu-btn moovu-btn-secondary text-red-600"
                    onClick={() => setReviewDraft({ requestId: row.id, action: "reject", note: "" })}
                    disabled={busyId === row.id}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="moovu-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black text-slate-950">Drivers owing commission</h2>
          <div className="text-sm font-bold text-slate-500">{driversWithBalances.length} open balance(s)</div>
        </div>
        <div className="mt-4 space-y-3">
          {driversWithBalances.length === 0 ? (
            <EmptyState title="No driver balances found" description="Driver commission balances will appear after completed trips." />
          ) : (
            driversWithBalances
              .map((row) => {
                const driverWallet = wallet(row);
                const balance = Number(driverWallet.balance_due ?? 0);
                const hasPending = pendingByDriver.has(driverId(row));
                const progress = Math.min(100, Math.round((balance / DRIVER_COMMISSION_LOCK_LIMIT) * 100));
                return (
                  <div key={driverId(row)} className="rounded-3xl border border-[var(--moovu-border)] bg-gradient-to-br from-white to-slate-50 p-4">
                    <div className="grid gap-3 md:grid-cols-5">
                      <div>
                        <div className="text-sm text-slate-500">Driver</div>
                        <div className="font-black text-slate-950">{driverName(row)}</div>
                        <div className="mt-1 text-xs text-slate-500">{driverPhone(row) || driverId(row)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-500">Balance owed</div>
                        <div className="font-semibold">{money(balance)}</div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${balance >= DRIVER_COMMISSION_LOCK_LIMIT ? "bg-red-500" : "bg-sky-500"}`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-500">Paid</div>
                        <div className="font-semibold">{money(driverWallet.total_paid)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-500">Last payment</div>
                        <div className="font-semibold">{displayDate(driverWallet.last_payment_at)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-500">Status</div>
                        <StatusBadge status={standing(balance, hasPending)} />
                      </div>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </section>
    </main>
  );
}
