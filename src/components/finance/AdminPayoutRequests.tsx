"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { rand } from "@/lib/finance/payoutsV2";

type Row = {
  id: string; driver_name: string; driver_phone: string | null; status: "REQUESTED" | "PAID" | "CANCELLED";
  card_earnings_cents: number; debt_recovered_cents: number; net_cents: number;
  payout_details: Record<string, string | null>; reference: string | null;
  requested_at: string; paid_at: string | null; cancel_reason: string | null;
};

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

async function api(method: "GET" | "POST", body?: unknown) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const res = await fetch("/api/admin/driver-payouts", {
    method, cache: "no-store",
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({ ok: false, error: "Network error." }));
}

/** Driver payout requests: pay by PayShap, then record the reference here. */
export default function AdminPayoutRequests() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [active, setActive] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const json = await api("GET");
    if (!json?.ok) { setMsg(json?.error ?? "Couldn't load payout requests."); setRows([]); return; }
    setActive(json.active !== false); setRows(json.requests ?? []);
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  async function act(row: Row, action: "paid" | "cancel") {
    if (action === "cancel" && !window.confirm(`Cancel ${row.driver_name}'s ${rand(row.net_cents)} request? They can request again.`)) return;
    setBusy(row.id); setMsg(null);
    const json = await api("POST", action === "paid"
      ? { action, requestId: row.id, reference: refs[row.id] ?? "" }
      : { action, requestId: row.id, reason: "Cancelled by admin" });
    setBusy(null);
    setMsg(json?.ok ? (action === "paid" ? "Marked as paid. The driver was notified." : "Request cancelled.") : json?.error);
    if (json?.ok) void load();
  }

  if (!rows) return <p className="text-sm text-slate-500">Loading payout requests…</p>;
  if (!active) return null;
  const open = rows.filter(r => r.status === "REQUESTED");
  const done = rows.filter(r => r.status !== "REQUESTED");

  return (
    <section className="moovu-card space-y-4 p-5">
      <div>
        <h2 className="text-xl font-black text-slate-950">Payout requests</h2>
        <p className="text-sm text-slate-500">Send the amount by PayShap, then enter the reference and tap Mark as paid. What the driver owed MOOVU has already been taken off.</p>
      </div>
      {msg && <p className="text-sm font-semibold text-slate-800" role="status">{msg}</p>}
      {open.length === 0 && <p className="text-sm text-slate-500">No payouts waiting.</p>}
      {open.map(row => {
        const d = row.payout_details ?? {};
        return (
          <article key={row.id} className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black text-slate-950">{row.driver_name}</p>
                <p className="text-xs text-slate-600">Requested {when(row.requested_at)}{row.driver_phone ? ` · ${row.driver_phone}` : ""}</p>
              </div>
              <p className="text-2xl font-black">{rand(row.net_cents)}</p>
            </div>
            <p className="text-sm text-slate-700">Card earnings {rand(row.card_earnings_cents)} − owed to MOOVU {rand(row.debt_recovered_cents)} = <b>pay {rand(row.net_cents)}</b></p>
            <p className="rounded-xl bg-white p-3 text-sm">
              {d.payshap_id ? <>PayShap: <b>{d.payshap_id}</b><br /></> : null}
              {d.account_number ? <>{d.bank_name} · {d.account_number}{d.branch_code ? ` · branch ${d.branch_code}` : ""}<br /></> : null}
              Name: {d.account_holder}
            </p>
            <div className="flex flex-wrap gap-2">
              <input className="min-w-0 flex-1 rounded-xl border px-3 py-2" placeholder="PayShap / bank reference"
                value={refs[row.id] ?? ""} onChange={e => setRefs(r => ({ ...r, [row.id]: e.target.value }))} />
              <button type="button" disabled={busy === row.id || (refs[row.id] ?? "").trim().length < 3}
                className="rounded-xl bg-slate-950 px-4 py-2 font-bold text-white disabled:opacity-40" onClick={() => act(row, "paid")}>Mark as paid</button>
              <button type="button" disabled={busy === row.id} className="rounded-xl border px-3 py-2 font-bold"
                onClick={() => act(row, "cancel")}>Cancel</button>
            </div>
          </article>
        );
      })}
      {done.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-bold">History ({done.length})</summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {done.map(row => (
              <li key={row.id} className="flex justify-between gap-3 py-2">
                <span>{row.driver_name} · {row.status === "PAID" ? `Paid ${when(row.paid_at)} · Ref ${row.reference}` : `Cancelled${row.cancel_reason ? ` · ${row.cancel_reason}` : ""}`}</span>
                <b>{rand(row.net_cents)}</b>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
