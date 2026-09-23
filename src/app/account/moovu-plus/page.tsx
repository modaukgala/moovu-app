"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Gift, ShieldCheck, Sparkles } from "lucide-react";
import CustomerBackHomeNav from "@/components/app-shell/CustomerBackHomeNav";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import { supabaseClient } from "@/lib/supabase/client";

type State = { membership_active: boolean; membership_expires_at: string | null; available_credit_cents: number; referral_code: string | null };
type Payment = { id: string; reference: string; status: string; submitted_at: string; review_reason: string | null };
type Credit = { id: string; source_type: string; expires_at: string; status: string; remaining_cents: number };

export default function MoovuPlusPage() {
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState("");
  const [referral, setReferral] = useState("");
  const [busy, setBusy] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [credits, setCredits] = useState<Credit[]>([]);

  const request = useCallback(async (method: "GET" | "POST", body?: object) => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = "/customer/auth?next=/account/moovu-plus"; return null; }
    const response = await fetch("/api/customer/phase5-account", { method, cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error(json?.error || "Request failed.");
    return json;
  }, []);
  const load = useCallback(async () => {
    const json = await request("GET");
    if (json?.state) { setState(json.state); setPayments(json.payments ?? []); setCredits(json.credits ?? []); }
  }, [request]);
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [load]);
  async function act(body: object, success: string) {
    setBusy(true); setMessage("");
    try { await request("POST", body); setMessage(success); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Request failed."); }
    finally { setBusy(false); }
  }
  return <main className="moovu-page min-h-screen pb-32 text-slate-950"><div className="moovu-shell max-w-3xl space-y-5 py-6">
    <CustomerBackHomeNav fallbackHref="/account" />
    <header className="rounded-3xl bg-slate-950 p-6 text-white"><span className="text-xs font-black uppercase tracking-widest text-emerald-300">Customer benefits</span><h1 className="mt-2 text-3xl font-black">MOOVU+</h1><p className="mt-2 text-sm text-slate-300">R99 for 30 days. Active members pay no MOOVU booking fee. Membership does not renew automatically.</p></header>
    {message ? <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-900">{message}</p> : null}
    <section className="moovu-card p-5"><div className="flex items-center gap-3"><Sparkles className="text-emerald-600"/><div><h2 className="font-black">Membership</h2><p className="text-sm text-slate-600">{state?.membership_active ? `Active until ${new Date(state.membership_expires_at!).toLocaleDateString()}` : "Not active"}</p></div></div>
      <p className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">New manual bank-transfer membership submissions are closed. Existing membership and payment history remain visible while MOOVU prepares a verified online membership checkout.</p>
      {payments.length ? <div className="mt-4 space-y-2">{payments.map((payment)=><div key={payment.id} className="rounded-xl border border-slate-200 p-3 text-sm"><strong>{payment.status}</strong> · {payment.reference}<span className="block text-xs text-slate-500">Submitted {new Date(payment.submitted_at).toLocaleString()}{payment.review_reason ? ` · ${payment.review_reason}` : ""}</span></div>)}</div> : null}
    </section>
    <section className="moovu-card p-5"><div className="flex items-center gap-3"><Gift className="text-emerald-600"/><div><h2 className="font-black">MOOVU Credits</h2><p className="text-sm text-slate-600">Available promotional credit: R{((state?.available_credit_cents ?? 0)/100).toFixed(2)}. Credit cannot be withdrawn or transferred.</p></div></div>
      {credits.filter((credit)=>credit.remaining_cents>0 && credit.status==="ACTIVE").map((credit)=><p key={credit.id} className="mt-3 text-xs text-slate-500">R{(credit.remaining_cents/100).toFixed(2)} · expires {new Date(credit.expires_at).toLocaleDateString()} · {credit.source_type.replaceAll("_", " ").toLowerCase()}</p>)}
    </section>
    <section className="moovu-card p-5"><h2 className="font-black">Invite someone to MOOVU</h2><p className="mt-2 text-sm text-slate-600">After their first eligible completed ride, you receive R20 MOOVU credit and they receive R10.</p>
      {state?.referral_code ? <button className="mt-3 flex items-center gap-2 font-black text-emerald-700" onClick={()=>void navigator.clipboard.writeText(state.referral_code!)}><Copy size={18}/> {state.referral_code}</button> : <button disabled={busy} className="moovu-btn moovu-btn-secondary mt-3" onClick={()=>void act({action:"ensure_referral_code"},"Referral code created.")}>Create my referral code</button>}
      <div className="mt-5 border-t pt-4"><label className="grid gap-2 text-sm font-bold">Have a referral code?<input className="moovu-input uppercase" value={referral} onChange={(e)=>setReferral(e.target.value)} maxLength={24}/></label><button disabled={busy || referral.trim().length<4} className="moovu-btn moovu-btn-secondary mt-3" onClick={()=>void act({action:"accept_referral",code:referral},"Referral accepted. Rewards unlock only after your first eligible completed ride.")}>Apply code</button></div>
    </section>
    <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-950"><ShieldCheck className="mt-0.5 shrink-0"/><p>Cancellation and no-show fees remain separate. MOOVU+ and promotional credit do not settle outstanding Phase 4 debt.</p></div>
  </div><CustomerBottomNav /></main>;
}
