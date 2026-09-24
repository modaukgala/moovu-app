"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { CheckCircle2, Clock3, CreditCard, TriangleAlert, XCircle } from "lucide-react";
import { closeHostedPaymentCheckout } from "@/lib/payments/checkoutNavigation";
import { supabaseClient } from "@/lib/supabase/client";
import { formatZarCents, paymentResultPresentation } from "@/lib/payments/onlinePayment";

type ResultKind = "success" | "cancel" | "failure";
type PaymentStatus = {
  state: string | null;
  amountCents: number | null;
  currency: string | null;
  context: string;
};

export default function PaymentResultClient(props: {
  kind: ResultKind;
  statusUrl: string;
  backHref: string;
  backLabel: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState(0);

  const load = useCallback(async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) {
      setError("Sign in to view this payment.");
      return;
    }
    const response = await fetch(props.statusUrl, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) {
      setError(body?.error ?? "Payment status is unavailable.");
      return;
    }
    setStatus(body.payment);
    setChecks((value) => value + 1);
  }, [props.statusUrl]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (props.kind !== "success" || !status || !["CREATED", "PENDING"].includes(status.state ?? "") || checks >= 8) return;
    const delay = Math.min(8000, 1000 * 2 ** Math.min(checks, 3));
    const timer = window.setTimeout(() => void load(), delay);
    return () => window.clearTimeout(timer);
  }, [checks, load, props.kind, status]);

  const presentation = paymentResultPresentation(props.kind, status?.state ?? null);
  const returnToApp = useCallback(async () => {
    await closeHostedPaymentCheckout();
    router.push(props.backHref);
  }, [props.backHref, router]);
  const Icon = presentation.kind === "success" ? CheckCircle2
    : presentation.kind === "pending" ? Clock3
      : presentation.kind === "failure" ? XCircle : TriangleAlert;
  const tone = presentation.kind === "success" ? "text-emerald-600 bg-emerald-50 border-emerald-200"
    : presentation.kind === "pending" ? "text-blue-700 bg-blue-50 border-blue-200"
      : presentation.kind === "neutral" ? "text-slate-700 bg-slate-50 border-slate-200"
        : "text-amber-800 bg-amber-50 border-amber-200";

  return (
    <main className="moovu-page flex min-h-screen items-center justify-center px-4 py-10 text-slate-950">
      <section className="moovu-card w-full max-w-xl p-6 text-center sm:p-10">
        <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full border ${tone}`}>
          <Icon className="h-10 w-10" aria-hidden="true" />
        </div>
        <p className="mt-5 text-xs font-black uppercase tracking-[0.16em] text-[var(--moovu-primary)]">MOOVU secure payment</p>
        <h1 className="mt-2 text-3xl font-black">{error ? "Payment status unavailable" : presentation.title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-600">
          {error ?? (presentation.kind === "success"
            ? "Your payment was verified by the trusted payment service."
            : presentation.kind === "pending"
              ? "Yoco returned you to MOOVU. We're confirming the payment through the trusted provider channel before updating your account."
              : "No payment authority was changed by this browser redirect.")}
        </p>
        {status?.amountCents != null && (
          <div className="mt-6 rounded-3xl border border-[var(--moovu-border)] bg-white p-5">
            <CreditCard className="mx-auto h-6 w-6 text-[var(--moovu-primary)]" aria-hidden="true" />
            <div className="mt-2 text-3xl font-black">{formatZarCents(status.amountCents)}</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">{status.context}</div>
          </div>
        )}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {presentation.kind === "pending" && checks >= 8 && (
            <button className="moovu-btn moovu-btn-secondary" type="button" onClick={() => { setChecks(0); void load(); }}>Check again</button>
          )}
          {Capacitor.isNativePlatform() ? (
            <button className="moovu-btn moovu-btn-primary" type="button" onClick={() => void returnToApp()}>{props.backLabel}</button>
          ) : (
            <Link className="moovu-btn moovu-btn-primary" href={props.backHref}>{props.backLabel}</Link>
          )}
        </div>
      </section>
    </main>
  );
}
