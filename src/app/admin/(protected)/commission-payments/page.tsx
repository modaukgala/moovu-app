"use client";

import { readFinancialJson, useFinancialRead } from "@/lib/admin/useFinancialRead";
import PaymentAllocation from "@/components/finance/PaymentAllocation";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createCommissionHistoryRequest } from "@/lib/admin/commissionHistoryRequest";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";

type CommissionRequest = {
  id: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string | null;
  payment_type: "subscription" | "commission" | "combined";
  amount_expected: number;
  amount_submitted: number;
  payment_reference: string;
  note: string | null;
  pop_file_url: string | null;
  status: string;
  review_note: string | null;
  submitted_at: string;
};

type SettlementDriver = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  status?: string | null;
  online?: boolean | null;
  driver?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  };
  wallet?: {
    balance_due: number;
    total_commission: number;
    total_paid: number;
    last_payment_at: string | null;
    last_payment_amount: number | null;
  };
  wallet_summary?: {
    balance_due: number;
    total_commission: number;
    total_driver_net?: number;
    total_trips_completed?: number;
    total_paid: number;
    last_payment_at: string | null;
    last_payment_amount: number | null;
    account_status?: string | null;
  };
};

type CommissionLedgerEntry = {
  id: string;
  trip_id?: string | null;
  tx_type: string;
  amount: number;
  direction: string;
  description?: string | null;
  created_at: string;
};

type CommissionLedger = {
  driverId: string;
  driverName: string;
  balanceDue: number;
  transactions: CommissionLedgerEntry[];
  pages: number[];
  totals: number[];
};

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function driverName(row: SettlementDriver) {
  const firstName = row.driver?.first_name ?? row.first_name ?? "";
  const lastName = row.driver?.last_name ?? row.last_name ?? "";
  return `${firstName} ${lastName}`.trim() || row.driver?.id || row.id || "Driver";
}

function driverId(row: SettlementDriver) {
  return row.driver?.id || row.id || "";
}

function driverPhone(row: SettlementDriver) {
  return row.driver?.phone ?? row.phone ?? null;
}

function wallet(row: SettlementDriver) {
  return row.wallet_summary ?? row.wallet ?? {
    balance_due: 0,
    total_commission: 0,
    total_paid: 0,
    last_payment_at: null,
    last_payment_amount: null,
  };
}

function standing(balanceDue: number, hasPending: boolean) {
  if (hasPending) return "pending review";
  if (balanceDue > 0) return "due";
  return "good standing";
}

export default function AdminCommissionPaymentsPage() {
  return <Suspense fallback={<p role="status">Loading payment queue…</p>}><PageContent /></Suspense>;
}

function PageContent() {
  const pendingOnly = useSearchParams().get("status") === "pending_payment_review";
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [driverPage, setDriverPage] = useState(1);
  const [ledger, setLedger] = useState<CommissionLedger | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerRequest] = useState(() => createCommissionHistoryRequest<{ row: SettlementDriver; pages: number[] }, CommissionLedger>());
  const [ledgerError, setLedgerError] = useState<string>();
  useEffect(() => () => ledgerRequest.invalidate(), [ledgerRequest]);
  const [historyKind, setHistoryKind] = useState(0);
  const [ledgerType, setLedgerType] = useState("all");
  const [ledgerDate, setLedgerDate] = useState("");
  const [reviewDraft, setReviewDraft] = useState<{
    requestId: string;
    action: "approve" | "reject" | "waiting";
    note: string;
  } | null>(null);

  const getToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token || "";
  }, []);

  const readAllocations = useCallback(async (_: string, signal: AbortSignal) =>
    (await readFinancialJson<{ requests: CommissionRequest[] }>("/api/admin/payment-reviews?status=all",
      await getToken(), signal, (body) => Array.isArray(body.requests))).requests, [getToken]);
  const allocationRead = useFinancialRead(String(driverPage), readAllocations);
  const requests = (allocationRead.data ?? []).filter((row) => row.payment_type === "commission" || row.payment_type === "combined");

  const readBalances = useCallback(async (page: string, signal: AbortSignal) =>
    readFinancialJson<{ drivers: SettlementDriver[]; driverPagination: { total: number } }>(
      `/api/admin/settlements?driverPage=${page}`, await getToken(), signal,
      (body) => Array.isArray(body.drivers) && Number.isSafeInteger((body.driverPagination as { total?: number } | undefined)?.total)), [getToken]);
  const balances = useFinancialRead(String(driverPage), readBalances);
  const drivers = balances.data?.drivers ?? [];
  const driverTotal = balances.data?.driverPagination.total ?? null;
  const loading = balances.loading || allocationRead.loading;
  const loadData = balances.reload;

  async function reviewRequest(
    requestId: string,
    action: "approve" | "reject" | "waiting",
    reviewNote: string,
  ) {
    setBusyId(requestId);
    setMsg(null);

    const token = await getToken();
    if (!token) {
      setBusyId(null);
      setMsg("You are not logged in.");
      return;
    }

    const res = await fetch("/api/admin/payment-reviews", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestId, action, reviewNote }),
    });

    const json = await res.json().catch(() => null);
    setBusyId(null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to review commission payment.");
      return;
    }

    setReviewDraft(null);
    setMsg(json?.message || "Commission payment updated.");
    await Promise.all([loadData(), allocationRead.reload()]);
  }

  async function openLedger(row: SettlementDriver, pages = [1, 1, 1]) {
    const id = driverId(row);
    if (!id) return;
    await ledgerRequest.run({ row, pages }, async ({ pages }, signal) => {
    const token = await getToken();
    const response = await fetch(
      `/api/admin/driver-wallet-summary?driverId=${encodeURIComponent(id)}&transactionPage=${pages[0]}&settlementPage=${pages[1]}&tripPage=${pages[2]}`,
      {
        cache: "no-store",
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    const json = await response.json().catch(() => null);
    const totals = [json?.pagination?.transactionTotal, json?.pagination?.settlementTotal, json?.pagination?.tripTotal];
    if (!response.ok || !json?.ok || !Number.isFinite(json.wallet?.balance_due) ||
        !totals.every(Number.isSafeInteger) ||
        ![json.transactions, json.settlements, json.recent_completed_trips].every(Array.isArray)) {
      throw new Error(json?.error || "Could not load the commission breakdown.");
    }

    const transactions: CommissionLedgerEntry[] = [
      ...(json.transactions ?? []).map((entry: CommissionLedgerEntry) => ({
        ...entry,
        amount: Number(entry.amount ?? 0),
      })),
      ...(json.settlements ?? []).map(
        (entry: { id: string; amount_paid: number; created_at: string; reference?: string | null }) => ({
          id: `settlement-${entry.id}`,
          tx_type: "direct_payment",
          amount: Number(entry.amount_paid ?? 0),
          direction: "credit",
          description: entry.reference ? `Payment ${entry.reference}` : "Commission payment",
          created_at: entry.created_at,
        }),
      ),
      ...json.recent_completed_trips.map((entry: { id: string; fare_amount: number | null; commission_amount: number | null; created_at: string }) => ({
        id: entry.id, trip_id: entry.id, tx_type: "completed_trip", direction: "debit",
        amount: entry.commission_amount, created_at: entry.created_at,
        description: entry.fare_amount == null ? "Recorded fare unavailable" : `Recorded fare: ${money(entry.fare_amount)}`,
      })),
    ].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return {
      driverId: id,
      driverName: driverName(row),
      balanceDue: json.wallet.balance_due,
      transactions,
      pages,
      totals,
    };
    }, ({ loading, error, result }) => {
      setLedgerLoading(loading);
      setLedgerError(error);
      if (result) setLedger(result);
    });
  }

  function invalidateLedgerRequest() {
    ledgerRequest.invalidate();
    setLedgerLoading(false);
    setLedgerError(undefined);
  }

  const filteredLedgerEntries = useMemo(() => {
    if (!ledger) return [];
    return ledger.transactions.filter((entry) => {
      const kind = entry.tx_type === "direct_payment" ? 1 : entry.tx_type === "completed_trip" ? 2 : 0;
      if (kind !== historyKind) return false;
      if (ledgerType !== "all" && entry.tx_type !== ledgerType) return false;
      if (ledgerDate && entry.created_at.slice(0, 10) !== ledgerDate) return false;
      return true;
    });
  }, [ledger, ledgerDate, ledgerType, historyKind]);

  const pendingRequests = requests.filter((row) =>
    row.status === "pending_payment_review" || (!pendingOnly && row.status === "waiting_confirmation")
  );
  const pendingByDriver = useMemo(
    () => new Set(pendingRequests.map((row) => row.driver_id)),
    [pendingRequests]
  );
  const driversWithBalances = drivers.filter((row) => Number(wallet(row).balance_due ?? 0) > 0);
  const totalOwed = drivers.reduce((sum, row) => sum + Number(wallet(row).balance_due ?? 0), 0);
  const totalCommissionEarned = drivers.reduce(
    (sum, row) => sum + Number(wallet(row).total_commission ?? 0),
    0
  );
  const totalPaid = drivers.reduce((sum, row) => sum + Number(wallet(row).total_paid ?? 0), 0);
  const owingDrivers = drivers.filter(
    (row) => Number(wallet(row).balance_due ?? 0) > 0
  );

  if (loading) {
    return (
      <LoadingState
        title="Loading commission payments"
        description="Preparing commission balances and pending driver POP reviews."
      />
    );
  }

  return (
    <main className="space-y-6 text-slate-950">
      {balances.error && <p role="alert">{balances.error} {balances.data && "Showing previously loaded balances."} <button onClick={balances.retry}>Retry balances</button></p>}
      {allocationRead.error && <p role="alert">{allocationRead.error} {allocationRead.data && "Showing previously loaded reviews."} <button onClick={allocationRead.retry}>Retry reviews</button></p>}
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      {reviewDraft && (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <section className="w-full max-w-lg rounded-[30px] bg-white p-5 shadow-2xl">
            <div className="moovu-section-title">Commission review</div>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              {reviewDraft.action === "approve"
                ? "Approve commission payment"
                : reviewDraft.action === "reject"
                  ? "Reject commission payment"
                  : "Waiting for bank confirmation"}
            </h2>
            <textarea
              value={reviewDraft.note}
              onChange={(event) =>
                setReviewDraft((current) =>
                  current ? { ...current, note: event.target.value } : current
                )
              }
              rows={4}
              className="moovu-input mt-4 resize-none"
              placeholder="Optional admin note"
            />
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button className="moovu-btn moovu-btn-secondary" onClick={() => setReviewDraft(null)}>
                Cancel
              </button>
              <button
                className="moovu-btn moovu-btn-primary"
                disabled={busyId === reviewDraft.requestId}
                onClick={() =>
                  void reviewRequest(reviewDraft.requestId, reviewDraft.action, reviewDraft.note.trim())
                }
              >
                {busyId === reviewDraft.requestId ? "Working..." : "Confirm"}
              </button>
            </div>
          </section>
        </div>
      )}

      {!ledger && ledgerError && <p role="alert">{ledgerError} <button onClick={() => {
                const request = ledgerRequest.failedRequest();
                if (request) void openLedger(request.row, request.pages);
              }}>Retry commission history</button></p>}
      {ledger && (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <section className="max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-[30px] bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="moovu-section-title">Commission breakdown</div>
                <h2 className="mt-2 text-2xl font-black text-slate-950">{ledger.driverName}</h2>
                <p className="mt-1 text-sm font-bold text-slate-500">
                  Current amount owed: {money(ledger.balanceDue)}
                </p>
              </div>
              <button className="moovu-icon-button" aria-label="Close breakdown" onClick={() => {
                invalidateLedgerRequest();
                setLedger(null);
              }}>
                X
              </button>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              {["Wallet transactions", "Direct commission payments", "Completed trips"].map((label, kind) => (
                <button key={label} aria-pressed={historyKind === kind} onClick={() => {
                  invalidateLedgerRequest(); setHistoryKind(kind); setLedgerType("all"); setLedgerDate("");
                }}>{label}</button>
              ))}
              {[-1, 1].map((step) => <button key={step} disabled={ledgerLoading || (step < 0
                ? ledger.pages[historyKind] === 1 : ledger.pages[historyKind] * 20 >= ledger.totals[historyKind])}
                onClick={() => {
                  const row = drivers.find((driver) => driverId(driver) === ledger.driverId);
                  if (row) void openLedger(row, ledger.pages.map((page, index) => page + (index === historyKind ? step : 0)));
                }}>{step < 0 ? "Previous" : "Next"}</button>)}
              <span>Page {ledger.pages[historyKind]} · {ledger.totals[historyKind]} records</span>
            </div>
            {ledgerError && <p role="alert">{ledgerError} <button onClick={() => {
                const request = ledgerRequest.failedRequest();
                if (request) void openLedger(request.row, request.pages);
              }}>Retry commission history</button></p>}
            <p className="text-sm">Filters apply to the visible page.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <select className="moovu-input" value={ledgerType} onChange={(event) => { invalidateLedgerRequest(); setLedgerType(event.target.value); }}>
                <option value="all">All transaction types</option>
                <option value="commission">Trip commission</option>
                <option value="cancellation_credit">Cancellation credit</option>
                <option value="payment">Payments</option>
              </select>
              <input
                className="moovu-input"
                type="date"
                value={ledgerDate}
                onChange={(event) => { invalidateLedgerRequest(); setLedgerDate(event.target.value); }}
                aria-label="Filter commission history by date"
              />
            </div>
            <div className="mt-5 space-y-3">
              {filteredLedgerEntries.length === 0 ? (
                <EmptyState title="No matching transactions" description="Change the transaction or date filter." />
              ) : (
                filteredLedgerEntries.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-black capitalize text-slate-950">
                          {entry.tx_type.replaceAll("_", " ")}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {entry.trip_id && <Link href={`/admin/trips/${entry.trip_id}`}>Trip {entry.trip_id.slice(0, 8)} · </Link>}
                          {displayDate(entry.created_at)}
                        </div>
                        {entry.description && <p className="mt-2 text-sm text-slate-600">{entry.description}</p>}
                      </div>
                      <div className={`font-black ${entry.tx_type === "commission" ? "text-red-600" : "text-emerald-700"}`}>
                        {entry.tx_type === "commission" ? "+" : "-"}{money(entry.amount)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      <section className="moovu-card overflow-hidden p-0">
        <div className="bg-gradient-to-br from-white via-sky-50 to-emerald-50 p-5 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="moovu-section-title">MOOVU Admin</div>
            <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
              Commission payments
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Review driver commission POPs, track outstanding balances, and keep MOOVU collections clear from subscription revenue.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/subscriptions" className="moovu-btn moovu-btn-secondary">
              Subscription payments
            </Link>
            <button className="moovu-btn moovu-btn-primary" onClick={() => void Promise.all([loadData(), allocationRead.reload()])}>
              Refresh
            </button>
          </div>
        </div>
        </div>
      </section>

      <div className="flex gap-3 items-center">
        <button disabled={driverPage === 1 || loading} onClick={() => setDriverPage(driverPage - 1)}>Previous drivers</button>
        <span>Driver page {driverPage}</span>
        <button disabled={driverTotal === null || driverPage * 50 >= driverTotal || loading} onClick={() => setDriverPage(driverPage + 1)}>Next drivers</button>
      </div>
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Commission owed on this page" value={driverTotal === null ? "Unavailable" : money(totalOwed)} tone="warning" />
        <MetricCard label="Pending reviews" value={String(pendingRequests.length)} helper="Commission POPs" tone={pendingRequests.length ? "warning" : "default"} />
        <MetricCard label="Drivers owing on this page" value={driverTotal === null ? "Unavailable" : String(owingDrivers.length)} />
        <MetricCard label="Recorded collections for these drivers" value={driverTotal === null ? "Unavailable" : money(totalPaid)} helper={driverTotal === null ? undefined : `${money(totalCommissionEarned)} accrued`} tone="primary" />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="moovu-card-interactive p-5">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">Collection rule</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Commission remains payable to MOOVU. Outstanding commission does not lock driver access.
          </p>
        </div>
        <div className="moovu-card-interactive p-5">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Review order</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Open proof, compare the bank reference, then approve, reject, or mark as waiting for bank confirmation.
          </p>
        </div>
        <div className="moovu-card-interactive p-5">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Clean split</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Commission reviews stay here. Subscription POPs stay under Subscriptions.
          </p>
        </div>
      </section>

      <section className="moovu-card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-slate-950">Pending commission reviews</h2>
          <StatusBadge status={pendingRequests.length ? "pending_payment_review" : "settled"} />
        </div>

        <div className="mt-4 space-y-4">
          {pendingRequests.length === 0 ? (
            <EmptyState title="No pending commission POPs" description="Commission payment submissions will appear here for admin review." />
          ) : (
            pendingRequests.map((row) => (
              <div key={row.id} className="moovu-card-interactive p-5">
                <div className="grid gap-4 md:grid-cols-5">
                  <div>
                    <div className="text-sm text-slate-500">Driver</div>
                    <div className="font-black text-slate-950">{row.driver_name}</div>
                    <div className="text-xs text-slate-500">{row.driver_phone || "Phone unavailable"}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Expected</div>
                    <div className="font-semibold">{money(row.amount_expected)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Submitted</div>
                    <div className="font-semibold">{money(row.amount_submitted)}</div>
                    <PaymentAllocation row={row} />
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Reference</div>
                    <div className="font-semibold break-words">{row.payment_reference}</div>
                    <Link
                      href={`/admin/payment-receipts/${row.id}`}
                      className="mt-1 inline-flex text-xs font-black text-[var(--moovu-primary)]"
                    >
                      Open receipt
                    </Link>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">POP</div>
                    {row.pop_file_url ? (
                      <a className="moovu-btn moovu-btn-secondary mt-1" href={row.pop_file_url} target="_blank" rel="noreferrer">
                        View proof
                      </a>
                    ) : (
                      <div className="text-sm font-semibold text-red-600">Missing POP</div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    className="moovu-btn moovu-btn-primary"
                    onClick={() => setReviewDraft({ requestId: row.id, action: "approve", note: "" })}
                    disabled={busyId === row.id}
                  >
                    Approve
                  </button>
                  <button
                    className="moovu-btn moovu-btn-secondary"
                    onClick={() => setReviewDraft({ requestId: row.id, action: "waiting", note: "" })}
                    disabled={busyId === row.id}
                  >
                    Waiting for bank
                  </button>
                  <button
                    className="moovu-btn moovu-btn-secondary text-red-600"
                    onClick={() => setReviewDraft({ requestId: row.id, action: "reject", note: "" })}
                    disabled={busyId === row.id}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="moovu-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black text-slate-950">Drivers owing commission</h2>
          <div className="text-sm font-bold text-slate-500">{driversWithBalances.length} open balance(s)</div>
        </div>
        <div className="mt-4 space-y-3">
          {driversWithBalances.length === 0 ? (
            <EmptyState title="No driver balances found" description="Driver commission balances will appear after completed trips." />
          ) : (
            driversWithBalances
              .map((row) => {
                const driverWallet = wallet(row);
                const balance = Number(driverWallet.balance_due ?? 0);
                const hasPending = pendingByDriver.has(driverId(row));
                return (
                  <div key={driverId(row)} className="rounded-3xl border border-[var(--moovu-border)] bg-gradient-to-br from-white to-slate-50 p-4">
                    <div className="grid gap-3 md:grid-cols-5">
                      <div>
                        <div className="text-sm text-slate-500">Driver</div>
                        <div className="font-black text-slate-950">{driverName(row)}</div>
                        <div className="mt-1 text-xs text-slate-500">{driverPhone(row) || "Phone unavailable"}</div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-500">Balance owed</div>
                        <div className="font-semibold">{money(balance)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-500">Paid</div>
                        <div className="font-semibold">{money(driverWallet.total_paid)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-500">Last payment</div>
                        <div className="font-semibold">{displayDate(driverWallet.last_payment_at)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-slate-500">Status</div>
                        <StatusBadge status={standing(balance, hasPending)} />
                        <button
                          type="button"
                          className="mt-3 text-sm font-black text-blue-700 underline"
                          disabled={ledgerLoading}
                          onClick={() => { setLedger(null); setHistoryKind(0); setLedgerType("all"); setLedgerDate(""); void openLedger(row); }}
                        >
                          {ledgerLoading ? "Loading..." : "View breakdown"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </section>
    </main>
  );
}
