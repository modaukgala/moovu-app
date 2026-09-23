"use client";

import { useCallback, useEffect, useState } from "react";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import DriverSectionTabs from "@/components/app-shell/DriverSectionTabs";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import DriverAuthRequired from "@/components/ui/DriverAuthRequired";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { DRIVER_SUBSCRIPTION_PLANS, type DriverSubscriptionPlan } from "@/lib/finance/driverPayments";
import { openHostedPaymentCheckout } from "@/lib/payments/checkoutNavigation";
import { supabaseClient } from "@/lib/supabase/client";

type DriverInfo = { subscription_status: string | null; subscription_plan: string | null; subscription_expires_at: string | null };
type SubscriptionPayment = { id: string; amount_paid: number; payment_method: string; reference: string | null; created_at: string };
type PaymentRequest = { id: string; payment_type: string; payment_reference: string; status: string; amount_submitted: number; submitted_at: string };
const BENEFITS: Record<DriverSubscriptionPlan, string> = { day: "Best for occasional driving", week: "Best for regular driving", month: "Best value for active drivers" };
const money = (value: number | null | undefined) => `R${Number(value ?? 0).toFixed(2)}`;
const displayDate = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "--";

export default function DriverSubscriptionsPage() {
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [legacyRequests, setLegacyRequests] = useState<PaymentRequest[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<DriverSubscriptionPlan>("week");

  const token = useCallback(async () => (await supabaseClient.auth.getSession()).data.session?.access_token ?? "", []);
  const load = useCallback(async () => {
    setLoading(true);
    const accessToken = await token();
    if (!accessToken) { setAuthRequired(true); setLoading(false); return; }
    const response = await fetch("/api/driver/earnings", { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) setMsg(body?.error ?? "Failed to load subscriptions.");
    else {
      setDriver(body.earnings?.driver ?? null);
      setPayments(body.earnings?.subscription_payments ?? []);
      setLegacyRequests((body.earnings?.payment_requests ?? []).filter((row: PaymentRequest) => row.payment_type === "subscription"));
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function payOnline() {
    setBusy(true); setMsg(null);
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Sign in to pay for a subscription.");
      const response = await fetch("/api/payments/yoco/driver/subscription/checkout", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok || !body.redirectUrl) throw new Error(body?.error ?? "Checkout is unavailable.");
      await openHostedPaymentCheckout(body.redirectUrl);
    } catch (error) { setMsg(error instanceof Error ? error.message : "Checkout is unavailable."); setBusy(false); }
  }

  if (loading) return <LoadingState title="Loading subscriptions" description="Checking your plan, expiry, and payment history." />;
  if (authRequired) return <DriverAuthRequired description="Sign in to manage your MOOVU driver subscription." />;
  const selected = DRIVER_SUBSCRIPTION_PLANS[selectedPlan];

  return <main className="moovu-page moovu-driver-shell pb-28 text-slate-950">
    {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
    <div className="moovu-shell space-y-6">
      <section className="moovu-card overflow-hidden p-0">
        <div className="bg-[linear-gradient(135deg,#f8fbff_0%,#eef8ff_46%,#f0fffa_100%)] p-5 sm:p-7">
          <div className="moovu-section-title">MOOVU Driver</div><h1 className="mt-2 text-2xl font-black sm:text-3xl">Subscriptions</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Choose a plan and pay securely online with Yoco. MOOVU confirms access only after the verified payment webhook.</p>
          <DriverSectionTabs section="money" />
        </div>
        <div className="moovu-driver-metric-grid moovu-driver-metric-grid-3 border-t border-[var(--moovu-border)] p-4 sm:p-5">
          <MetricCard label="Status" value={driver?.subscription_status ?? "inactive"} helper="Current access" tone={driver?.subscription_status === "active" ? "success" : "warning"} />
          <MetricCard label="Plan" value={driver?.subscription_plan ?? "No active plan"} helper="Current plan" />
          <MetricCard label="Expires" value={displayDate(driver?.subscription_expires_at)} helper="Verified subscription expiry" />
        </div>
      </section>

      <section className="moovu-driver-metric-grid moovu-driver-metric-grid-3">
        {(Object.entries(DRIVER_SUBSCRIPTION_PLANS) as Array<[DriverSubscriptionPlan, typeof DRIVER_SUBSCRIPTION_PLANS[DriverSubscriptionPlan]]>).map(([key, item]) => <button key={key} type="button" onClick={() => setSelectedPlan(key)} className={`rounded-[20px] border p-5 text-left transition ${selectedPlan === key ? "border-sky-300 bg-sky-50 shadow-[0_16px_38px_rgba(31,116,201,0.14)]" : "border-[var(--moovu-border)] bg-white shadow-sm"}`}>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">{item.label}</div><div className="mt-3 text-4xl font-black">{money(item.amount)}</div>
          <p className="mt-2 text-sm text-slate-600">{item.days} day{item.days === 1 ? "" : "s"} driver access.</p><p className="mt-1 text-xs font-semibold text-slate-500">{BENEFITS[key]}</p>
          {selectedPlan === key && <div className="mt-4"><StatusBadge status="selected" /></div>}
        </button>)}
      </section>

      <section className="moovu-card p-5 sm:p-6">
        <h2 className="text-xl font-black">Pay subscription online</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">The {selected.label.toLowerCase()} plan price is fixed by MOOVU at {money(selected.amount)}. The amount cannot be edited.</p>
        <button type="button" className="moovu-btn moovu-btn-primary mt-5 w-full sm:w-auto" disabled={busy} onClick={() => void payOnline()}>
          {busy ? "Preparing secure checkout..." : `Pay ${money(selected.amount)} online with Yoco`}
        </button>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="moovu-card p-5 sm:p-6"><h2 className="text-xl font-black">Verified payment history</h2><div className="mt-4 space-y-3">
          {payments.length === 0 ? <EmptyState title="No verified payments" description="Verified online subscription payments will appear here." /> : payments.map(row => <div key={row.id} className="rounded-3xl border border-[var(--moovu-border)] bg-white p-4"><div className="font-black">{money(row.amount_paid)} · {row.payment_method}</div><div className="mt-1 text-sm text-slate-600">{row.reference ?? "--"}</div><div className="mt-2 text-xs text-slate-500">{displayDate(row.created_at)}</div></div>)}
        </div></div>
        <div className="moovu-card p-5 sm:p-6"><h2 className="text-xl font-black">Historical manual requests</h2><p className="mt-2 text-sm text-slate-600">Previous records remain available for audit. New manual transfer submissions are closed.</p><div className="mt-4 space-y-3">
          {legacyRequests.length === 0 ? <EmptyState title="No historical requests" description="No previous manual subscription requests were found." /> : legacyRequests.map(row => <div key={row.id} className="rounded-3xl border border-[var(--moovu-border)] bg-white p-4"><div className="flex justify-between gap-3"><span className="font-black">{row.payment_reference}</span><StatusBadge status={row.status} /></div><div className="mt-2 text-sm text-slate-600">{money(row.amount_submitted)} · {displayDate(row.submitted_at)}</div></div>)}
        </div></div>
      </section>
    </div><DriverBottomNav />
  </main>;
}
