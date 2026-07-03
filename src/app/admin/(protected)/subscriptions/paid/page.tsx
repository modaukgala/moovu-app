"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";

type PaidSubscription = {
  id: string;
  driver_name: string;
  driver_phone: string | null;
  subscription_plan: string | null;
  amount_expected: number | null;
  amount_submitted: number | null;
  payment_reference: string | null;
  pop_file_url: string | null;
  status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

function money(value: number | null) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "--";
}

export default function PaidSubscriptionsPage() {
  const [rows, setRows] = useState<PaidSubscription[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session?.access_token) {
      setLoading(false);
      setError("Please sign in as an admin to view paid subscriptions.");
      return;
    }

    const response = await fetch("/api/admin/payment-reviews?status=all", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await response.json().catch(() => null);

    if (!response.ok || !json?.ok) {
      setLoading(false);
      setError(json?.error || "Could not load paid subscriptions.");
      return;
    }

    setRows(
      (json.requests ?? []).filter(
        (row: { payment_type?: string; status?: string }) =>
          row.payment_type === "subscription" && row.status === "approved",
      ),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [load]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.driver_name, row.driver_phone, row.payment_reference, row.subscription_plan].some((value) =>
        String(value ?? "").toLowerCase().includes(needle),
      ),
    );
  }, [query, rows]);

  if (loading) {
    return (
      <LoadingState
        title="Loading paid subscriptions"
        description="Preparing approved payments and proof records."
      />
    );
  }

  return (
    <main className="space-y-6">
      {error && (
        <CenteredMessageBox
          title="Could not load subscriptions"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      <header className="moovu-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="moovu-section-title">Payment archive</div>
          <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">Paid subscriptions</h1>
          <p className="mt-2 text-sm text-slate-600">
            Revisit approved subscription payments, payment dates, references and POPs.
          </p>
        </div>
        <Link href="/admin/subscriptions" className="moovu-btn moovu-btn-secondary">
          Back to subscriptions
        </Link>
      </header>

      <section className="moovu-card p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-black text-slate-700">
            {visibleRows.length} approved payment{visibleRows.length === 1 ? "" : "s"}
          </div>
          <input
            className="moovu-input sm:max-w-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search driver, phone or reference"
          />
        </div>

        <div className="mt-5 space-y-3">
          {visibleRows.length === 0 ? (
            <EmptyState
              title="No paid subscriptions found"
              description="Approved driver subscription payments will appear here."
            />
          ) : (
            visibleRows.map((row) => (
              <article
                key={row.id}
                className="rounded-3xl border border-[var(--moovu-border)] bg-white p-4 sm:p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-black text-slate-950">{row.driver_name}</h2>
                      <StatusBadge status="approved" />
                    </div>
                    <p className="mt-1 text-sm font-bold text-slate-500">
                      {row.driver_phone ?? "Phone unavailable"}
                    </p>
                  </div>
                  {row.pop_file_url ? (
                    <a
                      href={row.pop_file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="moovu-btn moovu-btn-secondary"
                    >
                      View POP
                    </a>
                  ) : (
                    <span className="text-sm font-bold text-amber-700">POP unavailable</span>
                  )}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="moovu-data-row">
                    <div className="text-xs font-bold text-slate-500">Plan</div>
                    <div className="mt-1 font-black capitalize">{row.subscription_plan ?? "--"}</div>
                  </div>
                  <div className="moovu-data-row">
                    <div className="text-xs font-bold text-slate-500">Paid</div>
                    <div className="mt-1 font-black">{money(row.amount_submitted)}</div>
                  </div>
                  <div className="moovu-data-row">
                    <div className="text-xs font-bold text-slate-500">Expected</div>
                    <div className="mt-1 font-black">{money(row.amount_expected)}</div>
                  </div>
                  <div className="moovu-data-row">
                    <div className="text-xs font-bold text-slate-500">Submitted</div>
                    <div className="mt-1 font-black">{dateTime(row.submitted_at)}</div>
                  </div>
                  <div className="moovu-data-row">
                    <div className="text-xs font-bold text-slate-500">Approved</div>
                    <div className="mt-1 font-black">{dateTime(row.reviewed_at)}</div>
                  </div>
                </div>

                <div className="mt-3 text-sm text-slate-600">
                  Reference: <span className="font-black text-slate-950">{row.payment_reference ?? "--"}</span>
                  {row.review_note ? ` | Review note: ${row.review_note}` : ""}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
