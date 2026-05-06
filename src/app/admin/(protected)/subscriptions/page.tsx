"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { DRIVER_SUBSCRIPTION_PLANS, type DriverSubscriptionPlan } from "@/lib/finance/driverPayments";
import { supabaseClient } from "@/lib/supabase/client";

type DriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  online: boolean | null;
  busy: boolean | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
  subscription_plan: string | null;
  created_at: string | null;
};

type SubEvent = {
  id: string;
  action: string;
  old_status: string | null;
  new_status: string | null;
  old_expires_at: string | null;
  new_expires_at: string | null;
  note: string | null;
  created_at: string;
  actor: string | null;
};

type SubscriptionRequest = {
  id: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string | null;
  payment_type: "subscription" | "commission" | "combined";
  subscription_plan: DriverSubscriptionPlan | null;
  amount_expected: number;
  amount_submitted: number;
  payment_reference: string;
  note: string | null;
  pop_file_url: string | null;
  status: string;
  review_note: string | null;
  submitted_at: string;
};

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function displayShortDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : "--";
}

function driverName(driver: DriverRow) {
  return `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || "Unnamed driver";
}

function planLabel(plan: string | null | undefined) {
  if (plan === "day" || plan === "week" || plan === "month") {
    const item = DRIVER_SUBSCRIPTION_PLANS[plan];
    return `${item.label} ${money(item.amount)}`;
  }

  return "No plan";
}

function isExpiringSoon(value: string | null | undefined) {
  if (!value) return false;
  const expiry = new Date(value).getTime();
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  return expiry > now && expiry - now <= threeDays;
}

function isActiveSubscription(status: string | null | undefined) {
  return status === "active" || status === "grace";
}

export default function AdminSubscriptionsPage() {
  const [q, setQ] = useState("");
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [selected, setSelected] = useState<DriverRow | null>(null);
  const [history, setHistory] = useState<SubEvent[]>([]);
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<{
    requestId: string;
    action: "approve" | "reject" | "waiting";
    note: string;
  } | null>(null);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }, []);

  const loadDrivers = useCallback(async () => {
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setDrivers([]);
      setMsg("You are not logged in.");
      setLoading(false);
      return;
    }

    const res = await fetch(`/api/admin/subscriptions/drivers?q=${encodeURIComponent(q)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const json = await res.json();
    if (!json.ok) {
      setDrivers([]);
      setMsg(json.error || "Failed to load drivers.");
      setLoading(false);
      return;
    }

    setDrivers(json.drivers ?? []);
    setLoading(false);
  }, [getAccessToken, q]);

  const loadPaymentRequests = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setRequests([]);
      return;
    }

    const res = await fetch("/api/admin/payment-reviews?status=all", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      setRequests([]);
      return;
    }

    setRequests(
      (json.requests ?? []).filter((row: SubscriptionRequest) =>
        row.payment_type === "subscription" || row.payment_type === "combined"
      )
    );
  }, [getAccessToken]);

  const loadHistory = useCallback(async (driverId: string) => {
    const token = await getAccessToken();
    if (!token) {
      setHistory([]);
      setMsg("You are not logged in.");
      return;
    }

    const res = await fetch(`/api/admin/subscriptions/history?driverId=${encodeURIComponent(driverId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const json = await res.json();
    if (json.ok) {
      setHistory(json.events ?? []);
    } else {
      setHistory([]);
      setMsg(json.error || "Failed to load subscription history.");
    }
  }, [getAccessToken]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadDrivers(), loadPaymentRequests()]);
  }, [loadDrivers, loadPaymentRequests]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadAll]);

  const selectedLabel = useMemo(() => {
    if (!selected) return "";
    const exp = selected.subscription_expires_at
      ? new Date(selected.subscription_expires_at).toLocaleString()
      : "--";
    return `${driverName(selected)} - ${selected.phone ?? "--"} - ${selected.subscription_status ?? "--"} - exp: ${exp}`;
  }, [selected]);

  const pendingRequests = requests.filter((row) =>
    ["pending_payment_review", "waiting_confirmation"].includes(row.status)
  );
  const activeDrivers = drivers.filter((driver) => isActiveSubscription(driver.subscription_status));
  const expiringSoon = drivers.filter((driver) => isExpiringSoon(driver.subscription_expires_at));
  const inactiveDrivers = drivers.filter((driver) => !isActiveSubscription(driver.subscription_status));
  const monthlySubscriptionRevenue = requests.reduce((sum, row) => {
    if (row.status !== "approved") return sum;
    const submittedAt = row.submitted_at ? new Date(row.submitted_at) : null;
    const now = new Date();
    const inMonth = submittedAt && submittedAt.getMonth() === now.getMonth() && submittedAt.getFullYear() === now.getFullYear();
    return sum + (inMonth ? Number(row.amount_submitted ?? 0) : 0);
  }, 0);

  async function act(action: string, days?: number) {
    if (!selected) return;

    setBusy(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      setMsg("You are not logged in.");
      return;
    }

    const res = await fetch("/api/admin/subscriptions/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        driverId: selected.id,
        action,
        days: days ?? null,
        note: note || null,
        plan: plan || null,
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Update failed.");
      return;
    }

    setMsg("Subscription updated.");
    await loadDrivers();
    await loadHistory(selected.id);
  }

  async function reviewRequest(
    requestId: string,
    action: "approve" | "reject" | "waiting",
    reviewNote: string,
  ) {
    setBusy(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
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
    setBusy(false);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to review subscription payment.");
      return;
    }

    setReviewDraft(null);
    setMsg(json.message || "Subscription payment updated.");
    await loadAll();
  }

  if (loading) {
    return (
      <LoadingState
        title="Loading subscriptions"
        description="Preparing plans, pending POP reviews, and driver subscription status."
      />
    );
  }

  return (
    <main className="space-y-6 text-slate-950">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      {reviewDraft && (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <section className="w-full max-w-lg rounded-[30px] bg-white p-5 shadow-2xl">
            <div className="moovu-section-title">Subscription review</div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              {reviewDraft.action === "approve"
                ? "Approve subscription payment"
                : reviewDraft.action === "reject"
                  ? "Reject subscription payment"
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
                disabled={busy}
                onClick={() =>
                  void reviewRequest(reviewDraft.requestId, reviewDraft.action, reviewDraft.note.trim())
                }
              >
                {busy ? "Working..." : "Confirm"}
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
                Subscription control
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Keep subscription POPs, driver access, expiries, and manual overrides in one clean workflow.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link href="/admin/commission-payments" className="moovu-btn moovu-btn-secondary">
                Commission payments
              </Link>
              <button className="moovu-btn moovu-btn-primary" onClick={() => void loadAll()}>
                Refresh
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-5">
        <MetricCard label="Active" value={String(activeDrivers.length)} helper="Active or grace" tone="success" />
        <MetricCard label="Pending POPs" value={String(pendingRequests.length)} helper="Needs admin review" tone={pendingRequests.length ? "warning" : "default"} />
        <MetricCard label="Expiring soon" value={String(expiringSoon.length)} helper="Within 3 days" tone={expiringSoon.length ? "warning" : "default"} />
        <MetricCard label="Inactive" value={String(inactiveDrivers.length)} helper="Expired, suspended, inactive" tone={inactiveDrivers.length ? "danger" : "default"} />
        <MetricCard label="Revenue this month" value={money(monthlySubscriptionRevenue)} helper="Approved subscription POPs" tone="primary" />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {Object.entries(DRIVER_SUBSCRIPTION_PLANS).map(([key, item]) => (
          <div key={key} className="moovu-card-interactive p-5">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">{item.label}</div>
            <div className="mt-2 text-3xl font-black text-slate-950">{money(item.amount)}</div>
            <p className="mt-2 text-sm text-slate-600">{item.days} day{item.days === 1 ? "" : "s"} access</p>
          </div>
        ))}
      </section>

      <section className="moovu-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-950">Pending subscription payments</h2>
            <p className="mt-1 text-sm text-slate-600">Approve only after matching the POP against the bank transaction.</p>
          </div>
          <StatusBadge status={pendingRequests.length ? "pending_payment_review" : "settled"} />
        </div>

        <div className="mt-4 space-y-4">
          {pendingRequests.length === 0 ? (
            <EmptyState title="No pending subscription POPs" description="Daily, weekly, and monthly payment proofs will appear here." />
          ) : (
            pendingRequests.map((row) => (
              <div key={row.id} className="moovu-card-interactive p-5">
                <div className="grid gap-4 md:grid-cols-6">
                  <div className="md:col-span-2">
                    <div className="text-sm text-slate-500">Driver</div>
                    <div className="font-black text-slate-950">{row.driver_name}</div>
                    <div className="text-xs text-slate-500">{row.driver_phone || row.driver_id}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Plan</div>
                    <div className="font-semibold">{planLabel(row.subscription_plan)}</div>
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

                <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
                  <span className="font-bold text-slate-950">Reference:</span> {row.payment_reference || "--"}
                  {row.note ? <span className="ml-2">Note: {row.note}</span> : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    className="moovu-btn moovu-btn-primary"
                    onClick={() => setReviewDraft({ requestId: row.id, action: "approve", note: "" })}
                    disabled={busy}
                  >
                    Approve
                  </button>
                  <button
                    className="moovu-btn moovu-btn-secondary"
                    onClick={() => setReviewDraft({ requestId: row.id, action: "waiting", note: "" })}
                    disabled={busy}
                  >
                    Waiting for bank
                  </button>
                  <button
                    className="moovu-btn moovu-btn-secondary text-red-600"
                    onClick={() => setReviewDraft({ requestId: row.id, action: "reject", note: "" })}
                    disabled={busy}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="moovu-card p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-950">Drivers</h2>
              <p className="mt-1 text-sm text-slate-600">Select a driver to adjust subscription access.</p>
            </div>
            <div className="flex gap-2">
              <input
                className="moovu-input"
                placeholder="Search driver"
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
              <button className="moovu-btn moovu-btn-secondary" onClick={() => void loadDrivers()}>
                Search
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {drivers.length === 0 ? (
              <EmptyState title="No drivers found" description="Try another search or check driver applications." />
            ) : (
              drivers.map((driver) => {
                const selectedDriver = selected?.id === driver.id;
                return (
                  <button
                    key={driver.id}
                    className={`w-full rounded-3xl border p-4 text-left ${
                      selectedDriver
                        ? "border-sky-300 bg-sky-50 shadow-[0_14px_34px_rgba(31,116,201,0.12)]"
                        : "border-[var(--moovu-border)] bg-white hover:border-sky-200 hover:bg-slate-50"
                    }`}
                    onClick={() => {
                      setSelected(driver);
                      void loadHistory(driver.id);
                      setPlan(driver.subscription_plan ?? "");
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-black text-slate-950">{driverName(driver)}</div>
                        <div className="mt-1 text-sm text-slate-500">{driver.phone ?? driver.email ?? "--"}</div>
                      </div>
                      <StatusBadge status={driver.subscription_status ?? "inactive"} />
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                      <div>{planLabel(driver.subscription_plan)}</div>
                      <div>Expires: {displayShortDate(driver.subscription_expires_at)}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6">
          <h2 className="text-xl font-black text-slate-950">Selected driver</h2>

          {!selected ? (
            <EmptyState title="Choose a driver" description="Subscription controls and history will appear here." />
          ) : (
            <div className="mt-4 space-y-5">
              <div className="rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-4">
                <div className="font-black text-slate-950">{selectedLabel}</div>
                <div className="mt-2 text-sm text-slate-600">Driver ID: {selected.id}</div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <input
                  className="moovu-input"
                  placeholder="Admin note for audit trail"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />

                <select
                  className="moovu-input bg-white"
                  value={plan}
                  onChange={(event) => setPlan(event.target.value)}
                >
                  <option value="">Keep existing plan</option>
                  <option value="day">Daily R45</option>
                  <option value="week">Weekly R100</option>
                  <option value="month">Monthly R250</option>
                </select>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <button className="moovu-btn moovu-btn-primary" disabled={busy} onClick={() => void act("activate")}>
                  Activate
                </button>
                <button className="moovu-btn moovu-btn-secondary" disabled={busy} onClick={() => void act("grace")}>
                  Grace
                </button>
                <button className="moovu-btn moovu-btn-secondary text-red-600" disabled={busy} onClick={() => void act("suspend")}>
                  Suspend
                </button>
                <button className="moovu-btn moovu-btn-secondary" disabled={busy} onClick={() => void act("inactive")}>
                  Set inactive
                </button>
                <button className="moovu-btn moovu-btn-secondary" disabled={busy} onClick={() => void act("extend", 7)}>
                  Extend 7 days
                </button>
                <button className="moovu-btn moovu-btn-secondary" disabled={busy} onClick={() => void act("extend", 30)}>
                  Extend 30 days
                </button>
              </div>

              <div className="rounded-3xl border border-[var(--moovu-border)] bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-black text-slate-950">History</h3>
                  <span className="text-sm font-bold text-slate-500">{history.length} event(s)</span>
                </div>

                {history.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No subscription history yet.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {history.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-black text-slate-950">{item.action}</div>
                          <div className="text-xs font-bold text-slate-500">{displayDate(item.created_at)}</div>
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          {item.old_status ?? "--"} to {item.new_status ?? "--"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          expiry: {displayDate(item.old_expires_at)} to {displayDate(item.new_expires_at)}
                        </div>
                        {item.note ? <div className="mt-1 text-xs text-slate-600">note: {item.note}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
