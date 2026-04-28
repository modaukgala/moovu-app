"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";

type PaymentRequestRow = {
  id: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string | null;
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

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayValue(value: string | null | undefined) {
  return value?.trim() || "--";
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

export default function AdminPaymentReviewsPage() {
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("pending_payment_review");
  const [rows, setRows] = useState<PaymentRequestRow[]>([]);

  async function getToken() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token || "";
  }

  async function loadData(status = statusFilter) {
    setLoading(true);
    setMsg(null);

    const token = await getToken();
    if (!token) {
      setMsg("You are not logged in.");
      setLoading(false);
      return;
    }

    const res = await fetch(`/api/admin/payment-reviews?status=${encodeURIComponent(status)}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load payment reviews.");
      setLoading(false);
      return;
    }

    setRows(json.requests ?? []);
    setLoading(false);
  }

  async function reviewRequest(requestId: string, action: "approve" | "reject" | "waiting") {
    const reviewNote = window.prompt("Optional review note:")?.trim() || "";

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
      body: JSON.stringify({
        requestId,
        action,
        reviewNote,
      }),
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setBusyId(null);
      setMsg(json?.error || "Failed to review payment request.");
      return;
    }

    setMsg(json?.message || "Payment request updated.");
    setBusyId(null);
    await loadData(statusFilter);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData(statusFilter);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const pendingCount = rows.filter((row) => row.status === "pending_payment_review").length;
  const approvedCount = rows.filter((row) => row.status === "approved").length;
  const rejectedCount = rows.filter((row) => row.status === "rejected").length;
  const submittedTotal = rows.reduce((total, row) => total + Number(row.amount_submitted ?? 0), 0);

  if (loading) {
    return (
      <LoadingState
        title="Loading payment reviews"
        description="Preparing submitted proof of payment requests for admin review."
      />
    );
  }

  return (
    <main className="space-y-6 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-card p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="moovu-section-title">MOOVU Admin</div>
            <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">Payment reviews</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Review subscription, commission and combined payments in one place.
            </p>
          </div>

          <Link href="/admin" className="moovu-btn moovu-btn-secondary">
            Back to Dashboard
          </Link>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Pending" value={String(pendingCount)} helper="Needs admin review" tone={pendingCount > 0 ? "warning" : "default"} />
        <MetricCard label="Approved" value={String(approvedCount)} helper="Approved in this filter" tone="success" />
        <MetricCard label="Rejected" value={String(rejectedCount)} helper="Rejected in this filter" tone={rejectedCount > 0 ? "danger" : "default"} />
        <MetricCard label="Submitted value" value={money(submittedTotal)} helper="Visible requests" tone="primary" />
      </section>

      <section className="moovu-card p-5 sm:p-6">
          <div className="flex flex-wrap gap-3">
            <select
              className="min-h-11 rounded-2xl border border-[var(--moovu-border)] bg-white px-4 py-3 text-sm font-semibold text-slate-950"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="pending_payment_review">Pending review</option>
              <option value="waiting_confirmation">Waiting confirmation</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="all">All</option>
            </select>

            <button
              onClick={() => void loadData(statusFilter)}
              className="moovu-btn moovu-btn-primary"
            >
              Refresh
            </button>
          </div>
        </section>

        <section className="space-y-4">
          {rows.length === 0 ? (
            <EmptyState
              title="No payment requests found"
              description="Payment proof submissions matching this filter will appear here."
            />
          ) : (
            <div className="space-y-4">
              {rows.map((row) => (
                <div key={row.id} className="moovu-card p-5 space-y-4">
                  <div className="grid md:grid-cols-6 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Driver</div>
                      <div className="font-medium">{row.driver_name}</div>
                      <div className="text-xs text-gray-500 mt-1">{row.driver_phone || row.driver_id}</div>
                    </div>

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
                      <div className="text-sm text-gray-500">Status</div>
                      <StatusBadge status={row.status} />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Reference</div>
                      <div className="font-medium">{row.payment_reference}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Submitted At</div>
                      <div className="font-medium">{displayDate(row.submitted_at)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">POP</div>
                      {row.pop_file_url ? (
                        <a
                          href={row.pop_file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="border rounded-xl px-3 py-2 inline-flex bg-white"
                        >
                          View POP
                        </a>
                      ) : (
                        <div className="font-medium">No POP uploaded</div>
                      )}
                    </div>
                  </div>

                  {row.note && (
                    <div className="text-sm text-gray-700">
                      Driver note: {row.note}
                    </div>
                  )}

                  {row.review_note && (
                    <div className="text-sm text-gray-700">
                      Review note: {row.review_note}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => reviewRequest(row.id, "approve")}
                      disabled={busyId === row.id}
                      className="rounded-xl px-4 py-3 text-white"
                      style={{ background: "var(--moovu-primary)" }}
                    >
                      {busyId === row.id ? "Working..." : "Approve"}
                    </button>

                    <button
                      onClick={() => reviewRequest(row.id, "waiting")}
                      disabled={busyId === row.id}
                      className="border rounded-xl px-4 py-3 bg-white"
                    >
                      {busyId === row.id ? "Working..." : "Still Waiting"}
                    </button>

                    <button
                      onClick={() => reviewRequest(row.id, "reject")}
                      disabled={busyId === row.id}
                      className="border rounded-xl px-4 py-3 bg-white text-red-600 border-red-300"
                    >
                      {busyId === row.id ? "Working..." : "Reject"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
    </main>
  );
}
