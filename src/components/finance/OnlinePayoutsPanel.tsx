"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type PayoutRow = {
  id: string;
  driver_id?: string;
  period_start: string;
  period_end: string;
  status: string;
  hold_reason?: string | null;
  fare_cents: number;
  current_commission_cents: number;
  driver_earnings_cents: number;
  actual_provider_fee_cents: number;
  driver_provider_fee_cents: number;
  prior_debt_recovery_cents: number;
  net_payout_cents: number;
  payout_method?: string | null;
  approved_at: string | null;
  paid_at: string | null;
  transfer_recorded_at?: string | null;
};
type BankEvidence = {
  id: string; batch_id: string; bank_transaction_reference: string;
  amount_cents: number; bank_state: "SETTLED" | "FAILED";
  source_type: string; imported_at: string; verified_at: string | null;
};
type ManualPayment = {
  id: string; batch_id: string; amount_cents: number; payment_at: string;
  method: "EFT" | "PAYSHAP"; bank_reference: string; state: "RECORDED" | "VERIFIED" | "FAILED";
  recorded_at: string; verified_at: string | null;
};
type ManualEvidence = { id: string; payment_id: string; bank_state: "SETTLED" | "FAILED"; reviewed_at: string | null };
type DriverIdentity = { id: string; first_name: string | null; last_name: string | null };
type PayoutItem = { id: string; batch_id: string };
type EligiblePayable = { id: string; driver_id: string; trip_id: string; payment_attempt_id: string;
  fare_cents: number; commission_cents: number; payable_cents: number; earned_at: string };

const money = (value: number) => new Intl.NumberFormat("en-ZA", {
  style: "currency", currency: "ZAR",
}).format(value / 100);
const date = (value: string) => new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium", timeZone: "Africa/Johannesburg",
}).format(new Date(value));
function amountToCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export default function OnlinePayoutsPanel({ role }: { role: "admin" | "driver" }) {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [bankEvidence, setBankEvidence] = useState<BankEvidence[]>([]);
  const [manualPayments, setManualPayments] = useState<ManualPayment[]>([]);
  const [manualEvidence, setManualEvidence] = useState<ManualEvidence[]>([]);
  const [drivers, setDrivers] = useState<DriverIdentity[]>([]);
  const [items, setItems] = useState<PayoutItem[]>([]);
  const [eligiblePayables, setEligiblePayables] = useState<EligiblePayable[]>([]);
  const [verifiedFeeAttemptIds, setVerifiedFeeAttemptIds] = useState<string[]>([]);
  const [draftDriver, setDraftDriver] = useState("");
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [remainingDebt, setRemainingDebt] = useState<number | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [transfer, setTransfer] = useState<Record<string, { amount: string; method: "PAYSHAP" | "EFT"; reference: string; proof: string; at: string }>>({});
  const approvalKeys = useRef(new Map<string, string>());
  const paymentKeys = useRef(new Map<string, string>());
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error("Sign in to view online payouts.");
        const response = await fetch(`/api/${role}/online-payouts`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store", signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Online payouts are unavailable.");
        if (!controller.signal.aborted) {
          setError("");
          setRows(result.batches ?? []);
          setAvailable(Boolean(result.available));
          if (role === "admin") setBankEvidence(result.bankEvidence ?? []);
          setManualPayments(result.manualPayments ?? []);
          setItems(result.items ?? []);
          if (role === "admin") {
            setManualEvidence(result.manualEvidence ?? []);
            setDrivers(result.drivers ?? []);
            setEligiblePayables(result.eligiblePayables ?? []);
            setVerifiedFeeAttemptIds(result.verifiedFeeAttemptIds ?? []);
          }
          if (role === "driver") setRemainingDebt(result.remainingCommissionDebtCents ?? null);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Online payouts are unavailable.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [role, refresh]);

  async function review(row: PayoutRow, action: "RECONCILE" | "HOLD" | "CANCEL" |
    "APPROVE" | "RECORD_MANUAL_PAYMENT" | "VERIFY_MANUAL_PAYMENT" | "SETTLE_DEBT_ONLY" |
    "CANCEL_APPROVED" | "MARK_FAILED",
    evidenceId?: string, paymentId?: string) {
    const explanation = reason[row.id]?.trim() ?? "";
    if (["HOLD", "CANCEL", "CANCEL_APPROVED", "MARK_FAILED"].includes(action) && explanation.length < 3) {
      setActionError("Enter a reason of at least three characters before holding or cancelling a payout.");
      return;
    }
    const transferDetails = transfer[row.id];
    const amountCents = amountToCents(transferDetails?.amount ?? "");
    if (action === "RECORD_MANUAL_PAYMENT" && (!transferDetails?.reference.trim() || !transferDetails.at ||
      Number.isNaN(Date.parse(transferDetails.at)) || amountCents === null ||
      amountCents > row.net_payout_cents - manualPayments.filter(payment => payment.batch_id === row.id && payment.state !== "FAILED")
        .reduce((sum, payment) => sum + payment.amount_cents, 0))) {
      setActionError("Enter a valid amount within the remaining balance, payment date and bank reference.");
      return;
    }
    if (!window.confirm(action === "RECORD_MANUAL_PAYMENT"
      ? `Mark ${money(amountCents ?? 0)} as paid outside MOOVU? This records your assertion only. Independent bank evidence is required before verification.`
      : `${action.replaceAll("_", " ")} this payout batch? This action does not initiate a bank transfer.`)) return;
    setBusyId(row.id);
    setActionError("");
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) throw new Error("Sign in again to review payouts.");
      const response = await fetch("/api/admin/online-payouts", {
        method: "POST", cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: row.id, action, reason: explanation,
          operationKey: action === "APPROVE" ?
            (approvalKeys.current.get(row.id) ?? (() => {
              const key = crypto.randomUUID(); approvalKeys.current.set(row.id, key); return key;
            })()) : action === "RECORD_MANUAL_PAYMENT" ?
              (paymentKeys.current.get(row.id) ?? (() => {
                const key = crypto.randomUUID(); paymentKeys.current.set(row.id, key); return key;
              })()) : undefined,
          amountCents: action === "RECORD_MANUAL_PAYMENT" ? amountCents : undefined,
          method: transferDetails?.method ?? "PAYSHAP",
          bankReference: transferDetails?.reference,
          proofReference: transferDetails?.proof,
          paymentAt: action === "RECORD_MANUAL_PAYMENT" ? new Date(transferDetails!.at).toISOString() : undefined,
          evidenceId, paymentId }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Payout review failed.");
      if (action === "APPROVE") approvalKeys.current.delete(row.id);
      if (action === "RECORD_MANUAL_PAYMENT") paymentKeys.current.delete(row.id);
      setRefresh(value => value + 1);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Payout review failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function createDraft() {
    if (!draftDriver || draftIds.length === 0 || !periodStart || !periodEnd) {
      setActionError("Choose a Driver, eligible trips and a weekly payout period."); return;
    }
    if (!window.confirm(`Create a draft for ${draftIds.length} verified-fee trip(s)? This does not transfer money.`)) return;
    setBusyId("draft"); setActionError("");
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) throw new Error("Sign in again to create a draft.");
      const response = await fetch("/api/admin/online-payouts", {
        method: "POST", cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CREATE_DRAFT", driverId: draftDriver, payableIds: draftIds,
          periodStart: new Date(`${periodStart}T00:00:00+02:00`).toISOString(),
          periodEnd: new Date(`${periodEnd}T00:00:00+02:00`).toISOString() }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Draft could not be created.");
      setDraftIds([]); setRefresh(value => value + 1);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Draft could not be created.");
    } finally { setBusyId(null); }
  }

  function exportCsv() {
    const columns = ["Batch", "Driver", "Period start", "Period end", "Status", "Locked fare cents",
      "Current commission cents", "Driver earnings cents", "Verified provider fee cents",
      "Driver fee share cents", "Prior debt recovery cents", "Net payout cents"];
    const content = [columns.map(csvCell).join(","), ...rows.map(row => [row.id, row.driver_id ?? "",
      row.period_start, row.period_end, row.status, row.fare_cents, row.current_commission_cents,
      row.driver_earnings_cents, row.actual_provider_fee_cents, row.driver_provider_fee_cents,
      row.prior_debt_recovery_cents, row.net_payout_cents].map(csvCell).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "moovu-online-payouts.csv"; link.click();
    URL.revokeObjectURL(url);
  }

  return <section className="moovu-card space-y-4 p-5 sm:p-6" aria-busy={loading}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-black text-slate-950">Driver payouts</h2>
        <p className="text-sm text-slate-600">MOOVU calculates the amount due. Admin pays outside MOOVU, then records it here. Only independent bank evidence verifies a payment.</p></div>
      {role === "admin" && rows.length > 0 && <button className="moovu-btn moovu-btn-secondary" onClick={exportCsv}>Export statement CSV</button>}
    </header>
    {actionError && <p role="alert" className="text-sm text-red-700">{actionError}</p>}
    {role === "admin" && available && <section className="rounded-xl border border-slate-200 p-4">
      <h3 className="font-bold">Create weekly payout draft</h3>
      <p className="text-sm text-slate-600">Only completed online trips with independently verified provider fees can enter a draft. Creating a draft does not pay a Driver.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Driver<select className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={draftDriver}
          onChange={event => { setDraftDriver(event.target.value); setDraftIds([]); }}>
          <option value="">Select Driver</option>
          {[...new Set(eligiblePayables.map(row => row.driver_id))].map(id => {
            const driver = drivers.find(item => item.id === id);
            return <option key={id} value={id}>{[driver?.first_name, driver?.last_name].filter(Boolean).join(" ") || `Driver ${id.slice(0, 8)}`}</option>;
          })}</select></label>
        <label className="text-sm">Period start<input type="date" className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={periodStart} onChange={event => setPeriodStart(event.target.value)} /></label>
        <label className="text-sm">Period end (exclusive)<input type="date" className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={periodEnd} onChange={event => setPeriodEnd(event.target.value)} /></label>
      </div>
      {draftDriver && <div className="mt-3 space-y-2">{eligiblePayables.filter(row => row.driver_id === draftDriver).map(row => {
        const ready = verifiedFeeAttemptIds.includes(row.payment_attempt_id);
        return <label key={row.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm">
          <input type="checkbox" disabled={!ready} checked={draftIds.includes(row.id)}
            onChange={event => setDraftIds(previous => event.target.checked ? [...previous, row.id] : previous.filter(id => id !== row.id))} />
          <span>{date(row.earned_at)} · Trip {row.trip_id.slice(0, 8)} · Fare {money(row.fare_cents)} · Driver earnings {money(row.payable_cents)} · {ready ? "Verified Yoco fee" : "Pending fee reconciliation"}</span>
        </label>;
      })}</div>}
      <button type="button" className="moovu-btn moovu-btn-secondary mt-3" disabled={busyId === "draft" || draftIds.length === 0}
        onClick={() => void createDraft()}>Create draft</button>
    </section>}
    {role === "driver" && remainingDebt !== null && <p className="text-sm text-slate-700">Remaining commission debt: <strong>{money(remainingDebt)}</strong>. R40 prompts a warning; R50 does not automatically block trips.</p>}
    {loading ? <p role="status">Loading online payouts…</p>
      : error ? <p role="alert" className="text-red-700">{error}</p>
      : !available ? <p role="status" className="text-slate-600">Manual payout records are not enabled in this environment.</p>
      : rows.length === 0 ? <p className="text-slate-600">No payout batches have been recorded.</p>
      : <div className="space-y-3">{rows.map(row => <details key={row.id} className="rounded-2xl border border-slate-200 p-4">
          <summary className="cursor-pointer list-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
            <span className="flex flex-wrap items-center justify-between gap-2"><strong>{date(row.period_start)}–{date(row.period_end)}</strong>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-800">{row.status.replaceAll("_", " ")}</span></span>
            <span className="mt-1 block text-sm text-slate-600">{role === "admin" && row.driver_id ? `${[drivers.find(driver => driver.id === row.driver_id)?.first_name, drivers.find(driver => driver.id === row.driver_id)?.last_name].filter(Boolean).join(" ") || `Driver ${row.driver_id.slice(0, 8)}`} · ` : ""}
              {row.status === "PAID" ? row.payout_method === "DEBT_OFFSET" ? "Settled against prior commission debt" : "Paid / Verified"
                : row.status === "APPROVED" ? row.net_payout_cents === 0 ? "Approved debt offset" : "Approved, awaiting bank payment"
                : row.status === "PAYMENT_RECORDED" ? "Payment Recorded" : "Preliminary"} · {money(row.net_payout_cents)}</span>
          </summary>
          <dl className="mt-4 grid gap-3 border-t border-slate-200 pt-4 text-sm sm:grid-cols-2">
            {([ ["Completed eligible trips", items.filter(item => item.batch_id === row.id).length],
              ["Locked trip fares", row.fare_cents], ["Current-trip commission", row.current_commission_cents],
              ["Driver trip earnings", row.driver_earnings_cents], ["Verified Yoco fees", row.actual_provider_fee_cents],
              ["Driver processing-fee contribution", row.driver_provider_fee_cents],
              ["Previous commission recovered", row.prior_debt_recovery_cents], ["Net payout", row.net_payout_cents] ] as const)
              .map(([label, value]) => <div key={label}><dt className="text-slate-600">{label}</dt><dd className="font-bold text-slate-950">{label === "Completed eligible trips" ? value : money(value)}</dd></div>)}
          </dl>
          {(() => {
            const payments = manualPayments.filter(payment => payment.batch_id === row.id);
            const recorded = payments.filter(payment => payment.state !== "FAILED")
              .reduce((sum, payment) => sum + payment.amount_cents, 0);
            const verified = payments.filter(payment => payment.state === "VERIFIED")
              .reduce((sum, payment) => sum + payment.amount_cents, 0);
            return <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-800">
              <p>Payment recorded: <strong>{money(recorded)}</strong> · Bank verified: <strong>{money(verified)}</strong></p>
              <p>Still to record: <strong>{money(Math.max(0, row.net_payout_cents - recorded))}</strong> · Awaiting verification: <strong>{money(Math.max(0, recorded - verified))}</strong></p>
              {payments.length > 0 && <ul className="mt-2 space-y-1">{payments.map(payment =>
                <li key={payment.id}>{date(payment.payment_at)} · {money(payment.amount_cents)} · {payment.method} · Reference {payment.bank_reference} · <strong>{payment.state === "VERIFIED" ? "Paid / Verified" : payment.state === "FAILED" ? "Bank transfer failed" : "Payment Recorded"}</strong>
                  {role === "admin" && payment.state === "RECORDED" && manualEvidence.some(item => item.payment_id === payment.id && !item.reviewed_at) &&
                    <button type="button" className="moovu-btn moovu-btn-secondary ml-2" disabled={busyId === row.id}
                      onClick={() => void review(row, "VERIFY_MANUAL_PAYMENT", undefined, payment.id)}>Review independent bank evidence</button>}</li>)}</ul>}
            </div>;
          })()}
          {row.hold_reason && <p className="mt-3 text-sm text-amber-800">Hold or exception: {row.hold_reason}</p>}
          {role === "admin" && bankEvidence.filter(item => item.batch_id === row.id).map(item =>
            <p key={item.id} className="mt-3 text-sm text-slate-700">Independent bank evidence: {item.bank_state.toLowerCase()} · {money(item.amount_cents)} · {item.source_type.replaceAll("_", " ")}. {item.verified_at ? "Verified." : "Awaiting second reviewer."}</p>)}
          {role === "admin" && <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
            {row.status !== "CANCELLED" && <div className="flex flex-wrap gap-2">
              {(row.status === "DRAFT" || row.status === "HELD") && <button type="button" className="moovu-btn moovu-btn-secondary" disabled={busyId === row.id} onClick={() => void review(row, "RECONCILE")}>Recheck reconciliation</button>}
              {(row.status === "DRAFT" || row.status === "RECONCILED") && <button type="button" className="moovu-btn moovu-btn-secondary" disabled={busyId === row.id} onClick={() => void review(row, "HOLD")}>Hold</button>}
              {row.status === "RECONCILED" && <button type="button" className="moovu-btn moovu-btn-primary" disabled={busyId === row.id} onClick={() => void review(row, "APPROVE")}>Approve payout amount</button>}
              {row.status === "APPROVED" && <button type="button" className="moovu-btn moovu-btn-secondary" disabled={busyId === row.id} onClick={() => void review(row, "CANCEL_APPROVED")}>Cancel approved batch</button>}
              {row.status === "APPROVED" && row.net_payout_cents === 0 && <button type="button" className="moovu-btn moovu-btn-primary" disabled={busyId === row.id} onClick={() => void review(row, "SETTLE_DEBT_ONLY")}>Settle by debt offset — no bank transfer</button>}
              {(row.status === "DRAFT" || row.status === "RECONCILED" || (row.status === "HELD" && !row.approved_at)) && <button type="button" className="moovu-btn moovu-btn-secondary" disabled={busyId === row.id} onClick={() => void review(row, "CANCEL")}>Cancel batch</button>}
            </div>}
            {(row.status === "DRAFT" || row.status === "RECONCILED" || row.status === "HELD" || row.status === "APPROVED" || row.status === "PAYMENT_RECORDED") && <label className="block text-sm text-slate-700">Reason for hold, cancellation or failure
              <input className="mt-1 w-full rounded-lg border border-slate-300 p-3" maxLength={500} value={reason[row.id] ?? ""}
                onChange={event => setReason(previous => ({ ...previous, [row.id]: event.target.value }))} />
            </label>}
            {(row.status === "APPROVED" || row.status === "PAYMENT_RECORDED") &&
              row.net_payout_cents > manualPayments.filter(payment => payment.batch_id === row.id && payment.state !== "FAILED")
                .reduce((sum, payment) => sum + payment.amount_cents, 0) && <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Amount paid (R)
                <input inputMode="decimal" className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={transfer[row.id]?.amount ?? ""}
                  onChange={event => setTransfer(previous => ({ ...previous, [row.id]: { amount: event.target.value,
                    method: previous[row.id]?.method ?? "PAYSHAP", reference: previous[row.id]?.reference ?? "",
                    proof: previous[row.id]?.proof ?? "", at: previous[row.id]?.at ?? "" } }))} /></label>
              <label className="text-sm">Bank method
                <select className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={transfer[row.id]?.method ?? "PAYSHAP"}
                  onChange={event => setTransfer(previous => ({ ...previous, [row.id]: { amount: previous[row.id]?.amount ?? "", method: event.target.value as "PAYSHAP" | "EFT", reference: previous[row.id]?.reference ?? "", proof: previous[row.id]?.proof ?? "", at: previous[row.id]?.at ?? "" } }))}>
                  <option value="PAYSHAP">PayShap</option><option value="EFT">EFT</option>
                </select></label>
              <label className="text-sm">Transfer reference
                <input className="mt-1 w-full rounded-lg border border-slate-300 p-3" maxLength={200} value={transfer[row.id]?.reference ?? ""}
                  onChange={event => setTransfer(previous => ({ ...previous, [row.id]: { amount: previous[row.id]?.amount ?? "", method: previous[row.id]?.method ?? "PAYSHAP", reference: event.target.value, proof: previous[row.id]?.proof ?? "", at: previous[row.id]?.at ?? "" } }))} /></label>
              <label className="text-sm sm:col-span-2">Proof reference (optional; not bank verification)
                <input className="mt-1 w-full rounded-lg border border-slate-300 p-3" maxLength={200} value={transfer[row.id]?.proof ?? ""}
                  onChange={event => setTransfer(previous => ({ ...previous, [row.id]: { amount: previous[row.id]?.amount ?? "", method: previous[row.id]?.method ?? "PAYSHAP", reference: previous[row.id]?.reference ?? "", proof: event.target.value, at: previous[row.id]?.at ?? "" } }))} /></label>
              <label className="text-sm sm:col-span-2">Payment date and time
                <input type="datetime-local" className="mt-1 w-full rounded-lg border border-slate-300 p-3" value={transfer[row.id]?.at ?? ""}
                  onChange={event => setTransfer(previous => ({ ...previous, [row.id]: { amount: previous[row.id]?.amount ?? "", method: previous[row.id]?.method ?? "PAYSHAP", reference: previous[row.id]?.reference ?? "", proof: previous[row.id]?.proof ?? "", at: event.target.value } }))} /></label>
              <button type="button" className="moovu-btn moovu-btn-primary sm:col-span-2" disabled={busyId === row.id} onClick={() => void review(row, "RECORD_MANUAL_PAYMENT")}>Mark as Paid — record manual payment</button>
            </div>}
            {row.status === "PAYMENT_RECORDED" && <p className="text-sm text-amber-800">Recorded payments await independently imported bank evidence. No bank transfer is initiated here.</p>}
            <p className="text-xs text-slate-600">Approval reserves previous debt. Only independent bank verification posts payouts and recovered debt. Bank charges belong to MOOVU.</p>
          </div>}
        </details>)}</div>}
  </section>;
}
