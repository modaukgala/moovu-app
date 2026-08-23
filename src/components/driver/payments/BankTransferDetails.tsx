"use client";

import { Check, Copy, Landmark, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { MOOVU_BANK_DETAILS } from "@/lib/finance/moovuBankDetails";

type CopyField = "account" | "branch";

type BankTransferDetailsProps = {
  amount?: string;
  purpose: "commission" | "subscription";
};

export default function BankTransferDetails({ amount, purpose }: BankTransferDetailsProps) {
  const [copiedField, setCopiedField] = useState<CopyField | null>(null);

  useEffect(() => {
    if (!copiedField) return;
    const timer = window.setTimeout(() => setCopiedField(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedField]);

  async function copyValue(field: CopyField, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
    } catch {
      setCopiedField(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-[22px] border border-sky-100 bg-[linear-gradient(145deg,#f7fbff_0%,#ffffff_52%,#f2fbf8_100%)] shadow-[0_16px_36px_rgba(31,116,201,0.08)]">
      <div className="flex items-start gap-3 border-b border-sky-100 px-4 py-4 sm:px-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white shadow-[0_8px_18px_rgba(37,99,235,0.22)]">
          <Landmark className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-black text-slate-950">Pay MOOVU by bank transfer</h2>
          <p className="mt-1 text-sm font-semibold leading-5 text-slate-600">
            Use these details for your {purpose} payment, then upload the proof of payment.
          </p>
        </div>
      </div>

      <dl className="grid gap-px bg-sky-100/70 sm:grid-cols-2">
        <BankDetail label="Bank" value={MOOVU_BANK_DETAILS.bankName} />
        <BankDetail label="Account type" value={MOOVU_BANK_DETAILS.accountType} />
        <BankDetail
          label="Account number"
          value={MOOVU_BANK_DETAILS.accountNumber}
          action={
            <CopyButton
              copied={copiedField === "account"}
              label="account number"
              onClick={() => void copyValue("account", MOOVU_BANK_DETAILS.accountNumber)}
            />
          }
        />
        <BankDetail
          label="Branch code"
          value={MOOVU_BANK_DETAILS.branchCode}
          action={
            <CopyButton
              copied={copiedField === "branch"}
              label="branch code"
              onClick={() => void copyValue("branch", MOOVU_BANK_DETAILS.branchCode)}
            />
          }
        />
      </dl>

      <div className="flex items-start gap-2 px-4 py-3 text-xs font-semibold leading-5 text-slate-600 sm:px-5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <span>
          {amount ? `Pay exactly ${amount}. ` : ""}
          MOOVU creates a separate review reference when your POP is submitted.
        </span>
      </div>
    </section>
  );
}

function BankDetail({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[76px] items-center justify-between gap-3 bg-white/95 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <dt className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</dt>
        <dd className="mt-1 break-all text-base font-black text-slate-950">{value}</dd>
      </div>
      {action}
    </div>
  );
}

function CopyButton({ copied, label, onClick }: { copied: boolean; label: string; onClick: () => void }) {
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

