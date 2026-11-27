"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { rand, REFUND_REASONS, type RefundReason } from "@/lib/finance/payoutsV2";

type State = {
  eligible: boolean; amountCents: number | null; alreadyRefunded: boolean;
  request: { status: "REQUESTED" | "REFUNDED" | "DECLINED"; decline_reason: string | null } | null;
};

/** On a cancelled card trip: lets the customer ask MOOVU for a refund, then shows where it stands. */
export default function RefundRequestCard({ tripId }: { tripId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RefundReason>("NO_DRIVER");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const token = async () => (await supabaseClient.auth.getSession()).data.session?.access_token ?? "";

  const load = useCallback(async () => {
    const res = await fetch(`/api/customer/refund-request?tripId=${encodeURIComponent(tripId)}`, {
      cache: "no-store", headers: { Authorization: `Bearer ${await token()}` },
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (json?.ok) setState(json);
  }, [tripId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  async function submit() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/customer/refund-request", {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tripId, reason, note }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setBusy(false);
    if (!json?.ok) { setMsg(json?.error ?? "Couldn't send your request. Please try again."); return; }
    setOpen(false); void load();
  }

  if (!state) return null;
  const status = state.request?.status;
  if (status === "REFUNDED" || (state.alreadyRefunded && status !== "REQUESTED")) {
    return <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Your refund has been sent.</p>;
  }
  if (status === "REQUESTED") {
    return <p className="mt-3 rounded-xl bg-white p-3 text-sm font-semibold text-slate-700">Refund requested. MOOVU will contact you on WhatsApp to arrange it.</p>;
  }
  if (!state.eligible) return null;

  return (
    <div className="mt-3 space-y-3 rounded-xl bg-white p-3 text-slate-800">
      {status === "DECLINED" && (
        <p className="text-sm">Your last refund request was declined{state.request?.decline_reason ? `: ${state.request.decline_reason}` : "."}</p>
      )}
      {!open ? (
        <button type="button" className="moovu-btn moovu-btn-primary w-full" onClick={() => setOpen(true)}>
          Request refund{state.amountCents ? ` (${rand(state.amountCents)})` : ""}
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-black">Why do you need a refund?</p>
          {(Object.keys(REFUND_REASONS) as RefundReason[]).map(key => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="radio" name={`refund-${tripId}`} checked={reason === key} onChange={() => setReason(key)} />
              {REFUND_REASONS[key]}
            </label>
          ))}
          <textarea className="w-full rounded-xl border border-slate-200 p-2 text-sm" rows={2} maxLength={500}
            placeholder="Anything else we should know? (optional)" value={note} onChange={e => setNote(e.target.value)} />
          {msg && <p className="text-sm font-semibold text-red-700" role="alert">{msg}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} className="moovu-btn moovu-btn-primary flex-1" onClick={submit}>{busy ? "Sending…" : "Send request"}</button>
            <button type="button" className="moovu-btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <p className="text-xs text-slate-500">MOOVU will message you on WhatsApp to arrange the refund.</p>
        </div>
      )}
    </div>
  );
}
