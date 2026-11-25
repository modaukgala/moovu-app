import type { SupabaseClient } from "@supabase/supabase-js";

export type DriverSettlement = {
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

/** Reads the netted driver balance (card earnings minus cash commission minus payouts). */
export async function getDriverSettlement(
  supabaseAdmin: SupabaseClient,
  driverId: string,
): Promise<{ ok: true; settlement: DriverSettlement } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin.rpc("phase2_driver_finance_position", { p_driver_id: driverId });
  const p = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (error || !p) return { ok: false, error: error?.message ?? "Finance position unavailable." };
  const n = (k: string) => Number(p[k] ?? 0);
  return {
    ok: true,
    settlement: {
      commissionDebtCents: n("commission_debt_cents"),
      cardEarningsCents: n("card_earnings_cents"),
      paidOutCents: n("paid_out_cents"),
      unappliedCreditCents: n("unapplied_credit_cents"),
      netOwedCents: n("net_owed_cents"),
      payoutDueCents: n("payout_due_cents"),
      debtLimitCents: n("debt_limit_cents"),
      locked: p.financially_eligible === false,
      paidUp: n("net_owed_cents") === 0,
    },
  };
}

export const SA_BANKS = [
  "Absa", "Capitec", "Discovery Bank", "FNB", "Investec", "Nedbank",
  "Standard Bank", "TymeBank", "African Bank", "Bank Zero", "Other",
] as const;

export function validateBankDetails(body: Record<string, unknown>) {
  const accountHolder = String(body.accountHolder ?? "").trim();
  const bankName = String(body.bankName ?? "").trim();
  const accountNumber = String(body.accountNumber ?? "").replace(/\s+/g, "");
  const branchCode = String(body.branchCode ?? "").replace(/\s+/g, "");
  const accountType = String(body.accountType ?? "cheque").trim().toLowerCase();
  if (accountHolder.length < 2) return { ok: false as const, error: "Enter the account holder name." };
  if (bankName.length < 2) return { ok: false as const, error: "Choose your bank." };
  if (!/^[0-9]{6,16}$/.test(accountNumber)) return { ok: false as const, error: "Account number must be 6–16 digits." };
  if (!/^[0-9]{6}$/.test(branchCode)) return { ok: false as const, error: "Branch code must be 6 digits." };
  if (!["cheque", "savings", "transmission"].includes(accountType)) return { ok: false as const, error: "Choose an account type." };
  return { ok: true as const, value: { account_holder: accountHolder, bank_name: bankName, account_number: accountNumber, branch_code: branchCode, account_type: accountType } };
}
