"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { readPaymentReceipt } from "@/lib/admin/paymentReceiptRead";
import { useFinancialRead } from "@/lib/admin/useFinancialRead";
import PaymentAllocation from "@/components/finance/PaymentAllocation";
import type { ComponentProps } from "react";
import LoadingState from "@/components/ui/LoadingState";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";

type PaymentRequestRow = ComponentProps<typeof PaymentAllocation>["row"] & {
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
  return value == null ? "Unavailable" : `R${Number(value).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function label(value: string | null | undefined) {
  return value?.replace(/_/g, " ") || "--";
}

export default function AdminPaymentReceiptPage() {
  const params = useParams<{ id: string }>();
  const receiptId = params.id;
  const read = useCallback(async (id: string, signal: AbortSignal) => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return await readPaymentReceipt(id, session?.access_token, signal) as PaymentRequestRow | null;
  }, []);
  const { data: payment, loading, error, retry } = useFinancialRead(receiptId, read);

  if (loading) return <LoadingState title="Loading receipt" description="Preparing the admin payment receipt." />;
  if (error) return <section className="moovu-card p-6">
    <h1 className="text-2xl font-black">Receipt unavailable</h1>
    <p role="alert">{error}</p>
    <button className="moovu-btn moovu-btn-secondary" onClick={retry}>Retry receipt</button>
    <Link href="/admin/payment-reviews" className="moovu-btn moovu-btn-secondary">Back to payment reviews</Link>
  </section>;

  return (
    <main className="space-y-6 text-slate-950">


      {!payment ? (
        <section className="moovu-card p-6">
          <h1 className="text-2xl font-black">Receipt not found</h1>
          <p className="mt-2 text-sm text-slate-600">This payment receipt is not available.</p>
          <Link href="/admin/payment-reviews" className="moovu-btn moovu-btn-primary mt-5">
            Back to payment reviews
          </Link>
        </section>
      ) : (
        <section className="moovu-card mx-auto max-w-4xl overflow-hidden p-0 print:shadow-none">
          <div className="bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-6">
            <div className="moovu-section-title">MOOVU admin payment receipt</div>
            <h1 className="mt-2 text-3xl font-black">{payment.payment_reference}</h1>
            <Link href="/admin/payment-reviews" className="underline">Back to payment reviews</Link>
            <div className="mt-3 flex flex-wrap gap-3">
              <StatusBadge status={payment.status} />
              <StatusBadge status={payment.payment_type} />
            </div>
          </div>

          <div className="px-6 pt-4"><PaymentAllocation row={payment} /></div>
          <div className="grid gap-4 p-6 md:grid-cols-3">
            <div className="rounded-3xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Driver</div>
              <div className="mt-2 font-black">{payment.driver_name}</div>
              <div className="text-sm text-slate-600">{payment.driver_phone ?? "Phone unavailable"}</div>
            </div>
            <div className="rounded-3xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Payment type</div>
              <div className="mt-2 font-black capitalize">{label(payment.payment_type)}</div>
              <div className="text-sm text-slate-600">Plan: {label(payment.subscription_plan)}</div>
            </div>
            <div className="rounded-3xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Status</div>
              <div className="mt-2 font-black capitalize">{label(payment.status)}</div>
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
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">POP</div>
              {payment.pop_file_url ? (
                <a className="mt-2 inline-flex font-bold text-[var(--moovu-primary)]" href={payment.pop_file_url} target="_blank" rel="noreferrer">
                  Open proof
                </a>
              ) : (
                <div className="mt-2 font-bold">No proof link</div>
              )}
            </div>
            <div className="rounded-3xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Submitted date</div>
              <div className="mt-2 font-bold">{displayDate(payment.submitted_at)}</div>
            </div>
            <div className="rounded-3xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Reviewed date</div>
              <div className="mt-2 font-bold">{displayDate(payment.reviewed_at)}</div>
            </div>
            <div className="rounded-3xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Driver note</div>
              <div className="mt-2 font-bold">{payment.note || "--"}</div>
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
    </main>
  );
}
