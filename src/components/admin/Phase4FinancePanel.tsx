"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type Assessment = { id: string; fee_type: string; policy_version: string;
  fee_cents: number; driver_cents: number; moovu_cents: number };
type Liability = { status: string; open_cents: number; collected_cents: number;
  waived_cents: number; written_off_cents: number; reversed_cents: number };
type Compensation = { status: string; earned_cents: number; settled_cents: number };
type Finance = { assessment: Assessment | null; liability: Liability | null;
  compensation: Compensation | null; grace: { id: string; started_at: string } | null;
  transaction: { id: string; transaction_state: string } | null;
  actions: Array<{ id: string; action_type: string; reason: string; created_at: string }>;
  events: Array<{ id: string; event_type: string; created_at: string }> };

const money = (cents: number) => `R${(Number(cents || 0) / 100).toFixed(2)}`;

export default function Phase4FinancePanel({ tripId }: { tripId: string }) {
  const [finance, setFinance] = useState<Finance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;
    const response = await fetch(`/api/admin/phase4-finance?tripId=${encodeURIComponent(tripId)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const body = await response.json().catch(() => null);
    if (!body?.ok) { setError(body?.error || "Finance state unavailable."); return; }
    setFinance(body as Finance);
    setError(null);
  }, [tripId]);
  useEffect(() => { void load(); }, [load]);

  async function act(action: "DISPUTE_OPENED" | "DISPUTE_RESOLVED" | "WAIVER" | "REVERSAL") {
    if (!finance?.assessment || reason.trim().length < 3) { setError("Enter a reason of at least three characters."); return; }
    setBusy(true);
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) throw new Error("Sign in again.");
      const response = await fetch("/api/admin/phase4-finance", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ assessmentId: finance.assessment.id, action, reason: reason.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!body?.ok) throw new Error(body?.error || "Financial action failed.");
      setReason("");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Financial action failed."); }
    finally { setBusy(false); }
  }

  if (!finance?.assessment) return null;
  const { assessment, liability, compensation } = finance;
  const unpaidUnsettled = !!liability && !!compensation
    && liability.open_cents === assessment.fee_cents && liability.collected_cents === 0
    && liability.waived_cents === 0 && liability.written_off_cents === 0
    && liability.reversed_cents === 0 && compensation.settled_cents === 0
    && !["CREDITED", "SETTLED", "REVERSED"].includes(compensation.status);
  return <section className="moovu-card p-5 sm:p-6" aria-label="Phase 4 finance">
    <h2 className="text-xl font-black text-slate-950">Phase 4 finance</h2>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    <div className="mt-3 grid gap-2 text-sm text-slate-800 sm:grid-cols-2">
      <p>Assessment: {assessment.id}</p><p>Type: {assessment.fee_type}</p>
      <p>Policy: {assessment.policy_version}</p><p>Customer fee: {money(assessment.fee_cents)}</p>
      <p>Driver earned: {money(assessment.driver_cents)}</p><p>MOOVU control: {money(assessment.moovu_cents)}</p>
      <p>Liability: {liability?.status ?? "Unavailable"} · Open {money(liability?.open_cents ?? 0)}</p>
      <p>Compensation: {compensation?.status ?? "Unavailable"} · Settled {money(compensation?.settled_cents ?? 0)}</p>
      <p>Grace: {finance.grace ? "Active" : "No active cycle"}</p>
      <p>Phase 1: {finance.transaction?.id ?? "Unavailable"} · {finance.transaction?.transaction_state ?? "Unknown"}</p>
    </div>
    <label className="mt-4 block text-sm font-semibold text-slate-800" htmlFor="phase4-action-reason">Mandatory action reason</label>
    <textarea id="phase4-action-reason" className="moovu-input mt-2" value={reason}
      onChange={(event) => setReason(event.target.value)} maxLength={500} />
    <div className="mt-3 flex flex-wrap gap-2">
      <button className="moovu-btn moovu-btn-secondary" disabled={busy || liability?.status !== "OPEN"}
        onClick={() => void act("DISPUTE_OPENED")}>Open dispute</button>
      <button className="moovu-btn moovu-btn-secondary" disabled={busy || liability?.status !== "DISPUTED"}
        onClick={() => void act("DISPUTE_RESOLVED")}>Resolve against Customer</button>
      <button className="moovu-btn moovu-btn-secondary" disabled={busy || !unpaidUnsettled}
        onClick={() => void act("WAIVER")}>Waive unpaid liability</button>
      <button className="moovu-btn moovu-btn-danger" disabled={busy || !unpaidUnsettled}
        onClick={() => void act("REVERSAL")}>Reverse erroneous assessment</button>
    </div>
    {!unpaidUnsettled && <p className="mt-2 text-xs text-amber-800">Collected or settled records require a separate supported financial process; waiver and reversal are unavailable here.</p>}
    <p className="mt-4 text-sm font-semibold">Actions: {finance.actions.length} · Business events: {finance.events.length}</p>
    <ul className="mt-2 text-xs text-slate-600">{finance.actions.map((action) =>
      <li key={action.id}>{action.action_type} · {action.reason} · {new Date(action.created_at).toLocaleString()}</li>)}</ul>
  </section>;
}
