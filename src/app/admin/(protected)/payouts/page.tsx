"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type Settlement = {
  commissionDebtCents: number; cardEarningsCents: number; paidOutCents: number;
  netOwedCents: number; payoutDueCents: number; debtLimitCents: number; locked: boolean; paidUp: boolean;
};
type Row = {
  driver: { id: string; first_name: string | null; last_name: string | null; phone: string | null; online: boolean | null };
  settlement: Settlement;
  bank: { account_holder: string; bank_name: string; account_number: string; branch_code: string; account_type: string } | null;
};
type Recent = { id: string; driver_id: string; amount_cents: number; reference: string | null; paid_at: string };

const rand = (c: number) => `R${(c / 100).toFixed(2)}`;
type Filter = "due" | "owing" | "locked" | "all";

export default function AdminPayoutsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [filter, setFilter] = useState<Filter>("due");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<Row | null>(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");

  const token = useCallback(async () => (await supabaseClient.auth.getSession()).data.session?.access_token ?? "", []);
  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/payouts", { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (body?.ok) { setRows(body.rows); setRecent(body.recentPayouts); } else setMsg(body?.error ?? "Could not load.");
    setLoading(false);
  }, [token]);
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const shown = useMemo(() => rows.filter((r) =>
    filter === "all" ? true
      : filter === "due" ? r.settlement.payoutDueCents > 0
      : filter === "owing" ? r.settlement.netOwedCents > 0
      : r.settlement.locked), [rows, filter]);
  const totals = useMemo(() => ({
    due: rows.reduce((a, r) => a + r.settlement.payoutDueCents, 0),
    owed: rows.reduce((a, r) => a + r.settlement.netOwedCents, 0),
    locked: rows.filter((r) => r.settlement.locked).length,
  }), [rows]);
  const nameOf = (id: string) => {
    const r = rows.find((x) => x.driver.id === id);
    return r ? `${r.driver.first_name ?? ""} ${r.driver.last_name ?? ""}`.trim() : id.slice(0, 8);
  };

  async function recordPayout() {
    if (!paying) return;
    setMsg(null);
    const res = await fetch("/api/admin/payouts/record", {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ driverId: paying.driver.id, amount: Number(amount), reference }),
    });
    const body = await res.json().catch(() => null);
    setMsg(body?.message ?? body?.error ?? "Failed.");
    if (body?.ok) { setPaying(null); setAmount(""); setReference(""); void load(); }
  }

  return (
    <div className="space-y-6 text-black">
      <div>
        <h1 className="text-2xl font-black">Driver balances &amp; payouts</h1>
        <p className="mt-1 text-sm text-slate-600">
          One balance per driver: card-trip earnings (85%) minus cash-trip commission (15%) minus payouts already made.
          Commission is deducted before anything is paid out. Drivers owing {rand(10000)} or more are locked from trips.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="moovu-card p-4"><p className="text-xs font-bold text-slate-500">Total payouts due</p><p className="text-2xl font-black text-emerald-700">{rand(totals.due)}</p></div>
        <div className="moovu-card p-4"><p className="text-xs font-bold text-slate-500">Total commission owed to MOOVU</p><p className="text-2xl font-black">{rand(totals.owed)}</p></div>
        <div className="moovu-card p-4"><p className="text-xs font-bold text-slate-500">Drivers locked</p><p className="text-2xl font-black text-red-700">{totals.locked}</p></div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["due", "owing", "locked", "all"] as Filter[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`moovu-btn ${filter === f ? "moovu-btn-primary" : "moovu-btn-secondary"}`}>
            {{ due: "Payout due", owing: "Owes MOOVU", locked: "Locked", all: "All" }[f]}
          </button>
        ))}
        <button type="button" className="moovu-btn moovu-btn-secondary" onClick={() => void load()}>Refresh</button>
      </div>

      {msg && <p className="moovu-card p-3 text-sm font-bold">{msg}</p>}
      {loading ? <p>Loading…</p> : (
        <div className="moovu-card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-3">Driver</th><th className="p-3">Card earnings</th><th className="p-3">Cash commission</th><th className="p-3">Paid out</th><th className="p-3">Balance</th><th className="p-3">Bank</th><th className="p-3"></th></tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={7}>Nothing here.</td></tr>}
              {shown.map((r) => (
                <tr key={r.driver.id} className="border-t border-slate-100">
                  <td className="p-3 font-bold">
                    {r.driver.first_name} {r.driver.last_name}
                    <div className="text-xs font-normal text-slate-500">{r.driver.phone}</div>
                    {r.settlement.paidUp && <span className="mt-1 inline-block rounded-full bg-emerald-100 px-2 text-xs text-emerald-800">Paid up</span>}
                    {r.settlement.locked && <span className="mt-1 inline-block rounded-full bg-red-100 px-2 text-xs text-red-800">Locked</span>}
                  </td>
                  <td className="p-3">{rand(r.settlement.cardEarningsCents)}</td>
                  <td className="p-3">{rand(r.settlement.commissionDebtCents)}</td>
                  <td className="p-3">{rand(r.settlement.paidOutCents)}</td>
                  <td className="p-3 font-black">
                    {r.settlement.payoutDueCents > 0
                      ? <span className="text-emerald-700">Pay {rand(r.settlement.payoutDueCents)}</span>
                      : r.settlement.netOwedCents > 0 ? <span className="text-red-700">Owes {rand(r.settlement.netOwedCents)}</span> : "—"}
                  </td>
                  <td className="p-3 text-xs">
                    {r.bank ? <>{r.bank.account_holder}<br />{r.bank.bank_name} · {r.bank.account_number}<br />Branch {r.bank.branch_code} · {r.bank.account_type}</>
                      : <span className="text-amber-700">No bank details</span>}
                  </td>
                  <td className="p-3">
                    {r.settlement.payoutDueCents > 0 && r.bank && (
                      <button type="button" className="moovu-btn moovu-btn-primary"
                        onClick={() => { setPaying(r); setAmount((r.settlement.payoutDueCents / 100).toFixed(2)); }}>
                        Record payout
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paying && (
        <div className="moovu-card space-y-3 p-5">
          <h2 className="text-lg font-black">Record payout to {paying.driver.first_name} {paying.driver.last_name}</h2>
          <p className="text-sm text-slate-600">Make the EFT from the MOOVU business account first, then record it here.</p>
          <input className="moovu-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (R)" />
          <input className="moovu-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="EFT reference" />
          <div className="flex gap-2">
            <button type="button" className="moovu-btn moovu-btn-primary" onClick={() => void recordPayout()}>Confirm payout</button>
            <button type="button" className="moovu-btn moovu-btn-secondary" onClick={() => setPaying(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="moovu-card p-5">
        <h2 className="text-lg font-black">Recent payouts</h2>
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {recent.length === 0 && <li className="py-2 text-slate-500">None yet.</li>}
          {recent.map((p) => (
            <li key={p.id} className="flex justify-between py-2">
              <span>{new Date(p.paid_at).toLocaleDateString("en-ZA")} · {nameOf(p.driver_id)} · {p.reference ?? "EFT"}</span>
              <span className="font-black">{rand(p.amount_cents)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
