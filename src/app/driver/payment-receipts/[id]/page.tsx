"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import DriverAuthRequired from "@/components/ui/DriverAuthRequired";
import LoadingState from "@/components/ui/LoadingState";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";

type DriverInfo = {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
};

type PaymentRequest = {
  id: string;
  payment_type: "subscription" | "commission" | "combined";
  subscription_plan: "day" | "week" | "month" | null;
  amount_expected: number;
  amount_submitted: number;
  payment_reference: string;
  status: string;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function label(value: string | null | undefined) {
  return value?.replace(/_/g, " ") || "--";
}

export default function DriverPaymentReceiptPage() {
  const params = useParams<{ id: string }>();
  const receiptId = params.id;
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [payment, setPayment] = useState<PaymentRequest | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      setAuthRequired(true);
      setLoading(false);
      return;
    }

    setAuthRequired(false);

    const res = await fetch("/api/driver/earnings", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Could not load receipt.");
      setLoading(false);
      return;
    }

    const row = ((json.earnings?.payment_requests ?? []) as PaymentRequest[]).find(
      (item) => item.id === receiptId,
    );

    setDriver(json.earnings?.driver ?? null);
    setPayment(row ?? null);
    setLoading(false);
  }, [receiptId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  if (loading) {
    return <LoadingState title="Loading receipt" description="Preparing your MOOVU payment receipt." />;
  }

  if (authRequired) {
    return <DriverAuthRequired description="Sign in to view your MOOVU payment receipt." />;
  }

  const driverName = `${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver";

  return (
    <main className="moovu-page moovu-driver-shell pb-28 text-slate-950">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
      <div className="moovu-shell">
        {!payment ? (
          <section className="moovu-card p-6">
            <h1 className="text-2xl font-black">Receipt not found</h1>
            <p className="mt-2 text-sm text-slate-600">
              This payment receipt could not be found for your driver account.
            </p>
            <Link href="/driver/earnings" className="moovu-btn moovu-btn-primary mt-5">
              Back to earnings
            </Link>
          </section>
        ) : (
          <section className="moovu-card mx-auto max-w-3xl overflow-hidden p-0 print:shadow-none">
            <div className="bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-6">
              <div className="moovu-section-title">MOOVU payment receipt</div>
              <h1 className="mt-2 text-3xl font-black">{payment.payment_reference}</h1>
              <div className="mt-3">
                <StatusBadge status={payment.status} />
              </div>
            </div>

            <div className="grid gap-4 p-6 sm:grid-cols-2">
              <div className="rounded-3xl bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Driver</div>
                <div className="mt-2 font-black">{driverName}</div>
                <div className="text-sm text-slate-600">{driver?.phone ?? "--"}</div>
              </div>
              <div className="rounded-3xl bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Payment type</div>
                <div className="mt-2 font-black capitalize">{label(payment.payment_type)}</div>
                <div className="text-sm text-slate-600">Plan: {label(payment.subscription_plan)}</div>
              </div>
              <div className="rounded-3xl bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Expected</div>
                <div className="mt-2 text-2xl font-black">{money(payment.amount_expected)}</div>
              </div>
              <div className="rounded-3xl bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Submitted</div>
                <div className="mt-2 text-2xl font-black">{money(payment.amount_submitted)}</div>
              </div>
              <div className="rounded-3xl bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Submitted date</div>
                <div className="mt-2 font-bold">{displayDate(payment.submitted_at)}</div>
              </div>
              <div className="rounded-3xl bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Reviewed date</div>
                <div className="mt-2 font-bold">{displayDate(payment.reviewed_at)}</div>
              </div>
            </div>

            {payment.review_note ? (
              <div className="px-6 pb-6">
                <div className="rounded-3xl border border-[var(--moovu-border)] bg-white p-4 text-sm">
                  <span className="font-black">Admin note:</span> {payment.review_note}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--moovu-border)] p-6 text-sm text-slate-600">
              <span>Support: admin@moovurides.co.za</span>
              <button className="moovu-btn moovu-btn-secondary print:hidden" onClick={() => window.print()}>
                Print receipt
              </button>
            </div>
          </section>
        )}
      </div>
      <DriverBottomNav />
    </main>
  );
}
