"use client";

import { useCallback, useEffect, useState } from "react";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import DriverSectionTabs from "@/components/app-shell/DriverSectionTabs";
import DriverAuthRequired from "@/components/ui/DriverAuthRequired";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import { openHostedPaymentCheckout } from "@/lib/payments/checkoutNavigation";
import { supabaseClient } from "@/lib/supabase/client";

type Settlement = {
  commissionDebtCents: number;
  cardEarningsCents: number;
  paidOutCents: number;
  unappliedCreditCents: number;
  netOwedCents: number;
  payoutDueCents: number;
  debtLimitCents: number;
  locked: boolean;
  paidUp: boolean;
};
type Payout = { id: string; amount_cents: number; reference: string | null; paid_at: string; status: string };
type Bank = { account_holder: string; bank_name: string; account_number: string; branch_code: string; account_type: string };

const BANKS = ["Absa", "Capitec", "Discovery Bank", "FNB", "Investec", "Nedbank", "Standard Bank", "TymeBank", "African Bank", "Bank Zero", "Other"];
const rand = (cents: number) => `R${(cents / 100).toFixed(2)}`;

export default function DriverPayoutsPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [bank, setBank] = useState<Bank>({ account_holder: "", bank_name: "", account_number: "", branch_code: "", account_type: "cheque" });
  const [hasBank, setHasBank] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const token = useCallback(async () => {
    const { data } = await supabaseClient.auth.getSession();
    return data.session?.access_token ?? "";
  }, []);

  const load = useCallback(async () => {
    const t = await token();
    if (!t) { setAuthed(false); setLoading(false); return; }
    setAuthed(true);
    const h = { Authorization: `Bearer ${t}` };
    const [s, b] = await Promise.all([
      fetch("/api/driver/settlement", { headers: h, cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/driver/bank-details", { headers: h, cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    if (s?.ok) { setSettlement(s.settlement); setPayouts(s.payouts ?? []); }
    else setMsg(s?.error ?? "Could not load your balance.");
    if (b?.ok && b.bank) { setBank(b.bank); setHasBank(true); }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  async function saveBank(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await fetch("/api/driver/bank-details", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountHolder: bank.account_holder, bankName: bank.bank_name, accountNumber: bank.account_number, branchCode: bank.branch_code, accountType: bank.account_type }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    setMsg(body?.message ?? body?.error ?? "Could not save.");
    if (body?.ok) setHasBank(true);
  }

  async function payCommission() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/payments/yoco/driver/checkout", { method: "POST", headers: { Authorization: `Bearer ${await token()}` } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.redirectUrl) { setBusy(false); setMsg(body?.error ?? "Online payment is unavailable."); return; }
    try {
      await openHostedPaymentCheckout(body.redirectUrl, { returnPath: `/driver/payment/success?attemptId=${encodeURIComponent(body.attemptId)}` });
    } catch (err) { setBusy(false); setMsg(err instanceof Error ? err.message : "Unable to open checkout."); }
  }

  if (authed === false) return <DriverAuthRequired description="Sign in to see your balance and payouts." />;
  if (loading) return <LoadingState title="Loading your balance" />;

  const s = settlement;
  return (
    <main className="moovu-page moovu-driver-shell text-black">
      <div className="moovu-shell space-y-6">
        <section className="moovu-card overflow-hidden p-0">
          <div className="p-5 sm:p-6">
            <div className="moovu-section-title">MOOVU Driver</div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-black text-slate-950 sm:text-3xl">Balance &amp; payouts</h1>
              {s?.paidUp && <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">✓ Paid up</span>}
            </div>
            <DriverSectionTabs section="money" />
          </div>
          {s && (
            <div className="border-t border-[var(--moovu-border)] p-5">
              {s.payoutDueCents > 0 ? (
                <>
                  <p className="text-sm font-bold text-slate-600">Payout due to you</p>
                  <p className="mt-2 text-3xl font-black text-emerald-700">{rand(s.payoutDueCents)}</p>
                  <p className="mt-2 text-sm text-slate-600">Card-trip earnings after commission. MOOVU pays this to your bank account.</p>
                </>
              ) : s.netOwedCents > 0 ? (
                <>
                  <p className="text-sm font-bold text-slate-600">You owe MOOVU</p>
                  <p className="mt-2 text-3xl font-black text-slate-950">{rand(s.netOwedCents)}</p>
                  <p className={`mt-2 text-sm font-bold ${s.locked ? "text-red-700" : "text-slate-600"}`}>
                    {s.locked
                      ? `Your account is locked. You owe ${rand(s.debtLimitCents)} or more. Pay now to go online again.`
                      : `You will be locked from trips at ${rand(s.debtLimitCents)}. Card trips also pay this off automatically.`}
                  </p>
                  <button type="button" className="moovu-btn moovu-btn-primary mt-4" disabled={busy} onClick={payCommission}>
                    {busy ? "Opening…" : `Pay ${rand(s.netOwedCents)} now`}
                  </button>
                </>
              ) : (
                <p className="text-lg font-black text-emerald-700">You are all square. Nothing owed, nothing due.</p>
              )}
            </div>
          )}
        </section>

        {s && (
          <section className="moovu-driver-metric-grid moovu-driver-metric-grid-3">
            <MetricCard label="Card-trip earnings" value={rand(s.cardEarningsCents)} helper="Your 85% of card trips" tone="success" />
            <MetricCard label="Cash-trip commission" value={rand(s.commissionDebtCents)} helper="15% of cash trips" />
            <MetricCard label="Paid out to you" value={rand(s.paidOutCents)} helper="Sent to your bank" />
          </section>
        )}

        {msg && <p className="moovu-card p-4 text-sm font-bold text-slate-700">{msg}</p>}

        <section className="moovu-card p-5 sm:p-6">
          <h2 className="text-xl font-black text-slate-950">Bank details for payouts</h2>
          <p className="mt-1 text-sm text-slate-600">{hasBank ? "Your payouts go to this account. Update it here if it changes." : "Add your bank account so MOOVU can pay you."}</p>
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={saveBank}>
            <input className="moovu-input" placeholder="Account holder name" value={bank.account_holder} onChange={(e) => setBank({ ...bank, account_holder: e.target.value })} />
            <select className="moovu-input" value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })}>
              <option value="">Choose bank</option>
              {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <input className="moovu-input" inputMode="numeric" placeholder="Account number" value={bank.account_number} onChange={(e) => setBank({ ...bank, account_number: e.target.value })} />
            <input className="moovu-input" inputMode="numeric" placeholder="Branch code (6 digits)" value={bank.branch_code} onChange={(e) => setBank({ ...bank, branch_code: e.target.value })} />
            <select className="moovu-input" value={bank.account_type} onChange={(e) => setBank({ ...bank, account_type: e.target.value })}>
              <option value="cheque">Cheque / current</option>
              <option value="savings">Savings</option>
              <option value="transmission">Transmission</option>
            </select>
            <button type="submit" className="moovu-btn moovu-btn-primary" disabled={busy}>{busy ? "Saving…" : "Save bank details"}</button>
          </form>
        </section>

        <section className="moovu-card p-5 sm:p-6">
          <h2 className="text-xl font-black text-slate-950">Payout history</h2>
          {payouts.length === 0 ? <p className="mt-2 text-sm text-slate-600">No payouts yet.</p> : (
            <ul className="mt-3 divide-y divide-slate-100">
              {payouts.map((p) => (
                <li key={p.id} className="flex justify-between py-3 text-sm">
                  <span>{new Date(p.paid_at).toLocaleDateString("en-ZA")} · {p.reference ?? "EFT"}</span>
                  <span className="font-black">{rand(p.amount_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <DriverBottomNav />
    </main>
  );
}
