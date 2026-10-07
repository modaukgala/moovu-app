"use client";

import { useCallback, useEffect, useState } from "react";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import DriverSectionTabs from "@/components/app-shell/DriverSectionTabs";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import DriverAuthRequired from "@/components/ui/DriverAuthRequired";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";

type SubscriptionPayment = { id: string; amount_paid: number; payment_method: string; reference: string | null; created_at: string };
type PaymentRequest = { id: string; payment_type: string; payment_reference: string; status: string; amount_submitted: number; submitted_at: string };
const money = (value: number | null | undefined) => `R${Number(value ?? 0).toFixed(2)}`;
const displayDate = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "--";

export default function DriverSubscriptionsPage() {
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [legacyRequests, setLegacyRequests] = useState<PaymentRequest[]>([]);

  const token = useCallback(async () => (await supabaseClient.auth.getSession()).data.session?.access_token ?? "", []);
  const load = useCallback(async () => {
    const accessToken = await token();
    setLoading(true);
    if (!accessToken) { setAuthRequired(true); setLoading(false); return; }
    const response = await fetch("/api/driver/earnings", { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) setMsg(body?.error ?? "Failed to load subscriptions.");
    else {
      setPayments(body.earnings?.subscription_payments ?? []);
      setLegacyRequests((body.earnings?.payment_requests ?? []).filter((row: PaymentRequest) => row.payment_type === "subscription"));
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  if (loading) return <LoadingState title="Loading subscription history" description="Loading historical payment records." />;
  if (authRequired) return <DriverAuthRequired description="Sign in to view your historical subscription records." />;

  return <main className="moovu-page moovu-driver-shell pb-28 text-slate-950">
    {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
    <div className="moovu-shell space-y-6">
      <section className="moovu-card overflow-hidden p-0">
        <div className="bg-[linear-gradient(135deg,#f8fbff_0%,#eef8ff_46%,#f0fffa_100%)] p-5 sm:p-7">
          <div className="moovu-section-title">MOOVU Driver</div><h1 className="mt-2 text-2xl font-black sm:text-3xl">Legacy subscription history</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Subscriptions are retired. Approved Drivers do not need a subscription to go online. Past payment records remain available here.</p>
          <DriverSectionTabs section="money" />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="moovu-card p-5 sm:p-6"><h2 className="text-xl font-black">Verified payment history</h2><div className="mt-4 space-y-3">
          {payments.length === 0 ? <EmptyState title="No verified payments" description="No historical subscription payments were found." /> : payments.map(row => <div key={row.id} className="rounded-3xl border border-[var(--moovu-border)] bg-white p-4"><div className="font-black">{money(row.amount_paid)} · {row.payment_method}</div><div className="mt-1 text-sm text-slate-600">{row.reference ?? "--"}</div><div className="mt-2 text-xs text-slate-500">{displayDate(row.created_at)}</div></div>)}
        </div></div>
        <div className="moovu-card p-5 sm:p-6"><h2 className="text-xl font-black">Historical manual requests</h2><p className="mt-2 text-sm text-slate-600">Previous records remain available for audit. New manual transfer submissions are closed.</p><div className="mt-4 space-y-3">
          {legacyRequests.length === 0 ? <EmptyState title="No historical requests" description="No previous manual subscription requests were found." /> : legacyRequests.map(row => <div key={row.id} className="rounded-3xl border border-[var(--moovu-border)] bg-white p-4"><div className="flex justify-between gap-3"><span className="font-black">{row.payment_reference}</span><StatusBadge status={row.status} /></div><div className="mt-2 text-sm text-slate-600">{money(row.amount_submitted)} · {displayDate(row.submitted_at)}</div></div>)}
        </div></div>
      </section>
    </div><DriverBottomNav />
  </main>;
}
