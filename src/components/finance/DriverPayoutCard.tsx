"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { PAYOUT_MINIMUM_CENTS, rand, type PayoutBalance } from "@/lib/finance/payoutsV2";

type Details = {
  payshap_id: string | null; bank_name: string; account_holder: string;
  account_number: string; branch_code: string; account_type: string;
} | null;

type HistoryRow = {
  id: string; status: "REQUESTED" | "PAID" | "CANCELLED"; card_earnings_cents: number;
  debt_recovered_cents: number; net_cents: number; reference: string | null;
  requested_at: string; paid_at: string | null; cancel_reason: string | null;
};

const STATUS_LABEL = { REQUESTED: "Waiting for MOOVU", PAID: "Paid", CANCELLED: "Cancelled" } as const;
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "";

/**
 * Card earnings a driver can request (minimum R50). What they owe MOOVU from cash trips comes off first.
 * Renders `fallback` while payouts v2 is not switched on, so nothing changes before activation.
 */
export default function DriverPayoutCard({ fallback }: { fallback: React.ReactNode }) {
  const [state, setState] = useState<{ balance: PayoutBalance; details: Details; history: HistoryRow[] } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ payshapId: "", bankName: "", accountHolder: "", accountNumber: "", branchCode: "", accountType: "cheque" });

  const call = useCallback(async (method: "GET" | "POST" | "PUT", body?: unknown) => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch("/api/driver/payout", {
      method, cache: "no-store",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json().catch(() => ({ ok: false, error: "Network error. Please try again." }));
  }, []);

  const load = useCallback(async () => {
    const json = await call("GET");
    if (json?.ok) setState({ balance: json.balance, details: json.details ?? null, history: json.history ?? [] });
    setLoaded(true);
  }, [call]);

  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  if (!loaded) return <p className="px-2 py-3 text-sm text-slate-500">Loading payouts…</p>;
  if (!state?.balance?.active) return <>{fallback}</>;

  const { balance, details, history } = state;
  const net = balance.net_cents ?? 0;
  const open = balance.open_request ?? null;
  const canRequest = !open && net >= PAYOUT_MINIMUM_CENTS && Boolean(details);

  async function requestPayout() {
    setBusy(true); setMsg(null);
    const json = await call("POST");
    setBusy(false);
    setMsg(json?.ok ? "Payout requested. MOOVU will send it by PayShap, usually today or tomorrow." : json?.error);
    if (json?.ok) void load();
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMsg(null);
    const json = await call("PUT", form);
    setBusy(false);
    if (!json?.ok) { setMsg(json?.error); return; }
    setEditing(false); setMsg("Payout details saved."); void load();
  }

  const field = (key: keyof typeof form, label: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="block text-sm font-semibold text-slate-700">{label}
      <input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base font-normal"
        value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} {...extra} />
    </label>
  );

  return (
    <section className="moovu-card space-y-4 p-5">
      <div>
        <p className="text-sm font-semibold text-slate-500">Available to pay out</p>
        <p className="text-3xl font-black text-slate-950">{rand(net)}</p>
        <dl className="mt-3 space-y-1 text-sm text-slate-600">
          <div className="flex justify-between"><dt>Card trip earnings</dt><dd>{rand(balance.card_earnings_cents)}</dd></div>
          <div className="flex justify-between"><dt>Less what you owe MOOVU</dt><dd>− {rand(balance.debt_recovered_cents)}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-slate-500">Card earnings are the fare minus commission. What you owe from cash trips (commission and booking fees) comes off first. Minimum payout is {rand(PAYOUT_MINIMUM_CENTS)}.</p>
      </div>

      {open ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="status">
          You requested {rand(open.net_cents)} on {day(open.requested_at)}. MOOVU will send it by PayShap soon.
        </p>
      ) : (
        <button type="button" disabled={!canRequest || busy} onClick={requestPayout}
          className="w-full rounded-2xl bg-slate-950 py-3.5 text-base font-black text-white disabled:opacity-40">
          {busy ? "Please wait…" : net < PAYOUT_MINIMUM_CENTS ? `Request payout (from ${rand(PAYOUT_MINIMUM_CENTS)})` : `Request ${rand(net)}`}
        </button>
      )}
      {msg && <p className="text-sm font-semibold text-slate-700" role="status">{msg}</p>}

      <div className="rounded-xl bg-slate-50 p-3 text-sm">
        {details && !editing ? (
          <div className="flex items-start justify-between gap-3">
            <p className="text-slate-700"><b>Paid to:</b> {details.payshap_id ? `PayShap ${details.payshap_id}` : `${details.bank_name} ${details.account_number}`}<br />
              <span className="text-slate-500">{details.account_holder}</span></p>
            <button type="button" className="font-bold underline" onClick={() => { setForm(f => ({ ...f, accountHolder: details.account_holder, bankName: details.bank_name, payshapId: details.payshap_id ?? "", branchCode: details.branch_code })); setEditing(true); }}>Change</button>
          </div>
        ) : editing || !details ? (
          <form className="space-y-3" onSubmit={saveDetails}>
            <p className="font-bold text-slate-800">Where should MOOVU pay you?</p>
            {field("accountHolder", "Account holder name", { autoComplete: "name", required: true })}
            {field("payshapId", "PayShap ShapID (e.g. your phone number@bank)", { placeholder: "0821234567@capitec" })}
            <p className="text-xs text-slate-500">No ShapID? Fill in your bank account instead.</p>
            {field("bankName", "Bank", { placeholder: "Capitec" })}
            {field("accountNumber", "Account number", { inputMode: "numeric" })}
            {field("branchCode", "Branch code (optional)", { inputMode: "numeric" })}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-slate-950 py-2.5 font-bold text-white disabled:opacity-40">Save</button>
              {details && <button type="button" className="rounded-xl border px-4 font-bold" onClick={() => setEditing(false)}>Cancel</button>}
            </div>
          </form>
        ) : null}
      </div>

      {history.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {history.map(row => (
            <li key={row.id} className="flex items-center justify-between py-2">
              <span>{day(row.paid_at ?? row.requested_at)} · {STATUS_LABEL[row.status]}{row.reference ? ` · Ref ${row.reference}` : ""}</span>
              <b>{rand(row.net_cents)}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
