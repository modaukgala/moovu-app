"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { rand, REFUND_REASONS, type RefundReason } from "@/lib/finance/payoutsV2";

type Row = {
  id: string; trip_id: string; amount_cents: number; reason: RefundReason; note: string | null;
  status: "REQUESTED" | "REFUNDED" | "DECLINED"; requested_at: string; resolved_at: string | null;
  reference: string | null; decline_reason: string | null; customer_name: string; customer_phone: string | null;
  trip: { pickup_address?: string | null; dropoff_address?: string | null; created_at?: string | null;
    cancelled_at?: string | null; cancelled_by?: string | null; cancellation_reason?: string | null; driver_id?: string | null } | null;
};

const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

/** South African number → wa.me link (digits only, 27 prefix). */
function whatsappHref(phone: string | null, text: string) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const intl = digits.startsWith("0") ? `27${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

async function api(method: "GET" | "POST", body?: unknown) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const res = await fetch("/api/admin/refunds", {
    method, cache: "no-store",
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({ ok: false, error: "Network error." }));
}

/** Customer refund requests: contact on WhatsApp, refund manually, then record it here. */
export default function AdminRefundRequests() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [active, setActive] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const json = await api("GET");
    if (!json?.ok) { setMsg(json?.error ?? "Couldn't load refund requests."); setRows([]); return; }
    setActive(json.active !== false); setRows(json.requests ?? []);
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  async function act(row: Row, action: "refunded" | "decline") {
    let reason = "";
    if (action === "decline") {
      reason = window.prompt("Why is this refund declined? The customer will be notified.") ?? "";
      if (!reason.trim()) return;
    }
    setBusy(row.id); setMsg(null);
    const json = await api("POST", { action, requestId: row.id, reference: refs[row.id] ?? "", reason });
    setBusy(null);
    setMsg(json?.ok ? (action === "refunded" ? "Marked as refunded. The customer was notified." : "Request declined.") : json?.error);
    if (json?.ok) void load();
  }

  if (!rows) return <p className="text-sm text-slate-500">Loading refund requests…</p>;
  if (!active) return <p className="text-sm text-slate-500">Refund requests aren&apos;t switched on yet.</p>;
  const open = rows.filter(r => r.status === "REQUESTED");
  const done = rows.filter(r => r.status !== "REQUESTED");

  return (
    <section className="space-y-4">
      {msg && <p className="text-sm font-semibold text-slate-800" role="status">{msg}</p>}
      {open.length === 0 && <p className="moovu-card p-5 text-sm text-slate-500">No refund requests waiting.</p>}
      {open.map(row => {
        const wa = whatsappHref(row.customer_phone,
          `Hi ${row.customer_name}, this is MOOVU about your refund request of ${rand(row.amount_cents)}. Please send your bank name, account holder and account number so we can pay it back.`);
        return (
          <article key={row.id} className="moovu-card space-y-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black text-slate-950">{row.customer_name}</p>
                <p className="text-xs text-slate-600">Requested {when(row.requested_at)} · {REFUND_REASONS[row.reason]}</p>
              </div>
              <p className="text-2xl font-black">{rand(row.amount_cents)}</p>
            </div>
            {row.note && <p className="rounded-xl bg-slate-50 p-3 text-sm">“{row.note}”</p>}
            <p className="text-sm text-slate-700">
              {row.trip?.pickup_address} → {row.trip?.dropoff_address}<br />
              Booked {when(row.trip?.created_at)} · Cancelled {when(row.trip?.cancelled_at)}
              {row.trip?.cancelled_by ? ` by ${row.trip.cancelled_by}` : ""} · {row.trip?.driver_id ? "A driver had accepted" : "No driver accepted"}
              {row.trip?.cancellation_reason ? <><br />Reason: {row.trip.cancellation_reason}</> : null}
            </p>
            {wa && <a href={wa} target="_blank" rel="noreferrer" className="inline-block rounded-xl bg-green-600 px-4 py-2 font-bold text-white">Message on WhatsApp</a>}
            <div className="flex flex-wrap gap-2">
              <input className="min-w-0 flex-1 rounded-xl border px-3 py-2" placeholder="Refund payment reference"
                value={refs[row.id] ?? ""} onChange={e => setRefs(r => ({ ...r, [row.id]: e.target.value }))} />
              <button type="button" disabled={busy === row.id || (refs[row.id] ?? "").trim().length < 3}
                className="rounded-xl bg-slate-950 px-4 py-2 font-bold text-white disabled:opacity-40" onClick={() => act(row, "refunded")}>Mark refunded</button>
              <button type="button" disabled={busy === row.id} className="rounded-xl border px-3 py-2 font-bold" onClick={() => act(row, "decline")}>Decline</button>
            </div>
          </article>
        );
      })}
      {done.length > 0 && (
        <details className="moovu-card p-5">
          <summary className="cursor-pointer text-sm font-bold">History ({done.length})</summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {done.map(row => (
              <li key={row.id} className="flex justify-between gap-3 py-2">
                <span>{row.customer_name} · {row.status === "REFUNDED" ? `Refunded ${when(row.resolved_at)} · Ref ${row.reference}` : `Declined${row.decline_reason ? ` · ${row.decline_reason}` : ""}`}</span>
                <b>{rand(row.amount_cents)}</b>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
