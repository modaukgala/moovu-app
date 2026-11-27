/** Shared, client-safe helpers for driver payouts and customer refund requests (payouts v2). */

export const PAYOUT_MINIMUM_CENTS = 5000;

export type PayoutBalance = {
  active: boolean;
  from?: string;
  minimum_cents?: number;
  card_earnings_cents?: number;
  owed_cents?: number;
  debt_recovered_cents?: number;
  net_cents?: number;
  open_request?: PayoutRequestRow | null;
};

export type PayoutRequestRow = {
  id: string;
  driver_id: string;
  status: "REQUESTED" | "PAID" | "CANCELLED";
  card_earnings_cents: number;
  debt_recovered_cents: number;
  net_cents: number;
  payout_details: Record<string, string | null>;
  method: string;
  reference: string | null;
  requested_at: string;
  paid_at: string | null;
  cancel_reason: string | null;
};

export type PayoutDetailsInput = {
  payshapId: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  branchCode: string;
  accountType: string;
};

export const REFUND_REASONS = {
  NO_DRIVER: "No driver arrived",
  DRIVER_CANCELLED: "The driver cancelled",
  OTHER: "Something else",
} as const;
export type RefundReason = keyof typeof REFUND_REASONS;

export function isRefundReason(value: unknown): value is RefundReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REFUND_REASONS, value);
}

export function rand(cents: number | null | undefined) {
  return `R${(Number(cents ?? 0) / 100).toFixed(2)}`;
}

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

/** Validates payout details: a PayShap ShapID, or a full bank account, is required. */
export function normalizePayoutDetails(raw: unknown):
  | { ok: true; value: PayoutDetailsInput }
  | { ok: false; error: string } {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const value: PayoutDetailsInput = {
    payshapId: clean(body.payshapId, 60),
    bankName: clean(body.bankName, 60),
    accountHolder: clean(body.accountHolder, 80),
    accountNumber: clean(body.accountNumber, 20).replace(/\s+/g, ""),
    branchCode: clean(body.branchCode, 10).replace(/\s+/g, ""),
    accountType: clean(body.accountType, 20) || "cheque",
  };
  if (!value.accountHolder) return { ok: false, error: "Enter the account holder's name." };
  if (value.payshapId && value.payshapId.length < 4) return { ok: false, error: "That ShapID looks too short." };
  if (!value.payshapId) {
    if (!value.bankName) return { ok: false, error: "Enter your bank, or a PayShap ShapID." };
    if (!/^\d{6,16}$/.test(value.accountNumber)) return { ok: false, error: "Enter a valid account number (digits only)." };
  }
  if (value.accountNumber && !/^\d{6,16}$/.test(value.accountNumber)) {
    return { ok: false, error: "Enter a valid account number (digits only)." };
  }
  if (value.branchCode && !/^\d{4,8}$/.test(value.branchCode)) {
    return { ok: false, error: "Enter a valid branch code (digits only)." };
  }
  return { ok: true, value };
}

const RPC_MESSAGES: Record<string, string> = {
  PAYOUT_NOT_ELIGIBLE: "Payouts aren't available on this account.",
  PAYOUTS_NOT_ACTIVE: "Payouts aren't switched on yet.",
  PAYOUT_ALREADY_REQUESTED: "You already have a payout request waiting. MOOVU will pay it soon.",
  PAYOUT_BELOW_MINIMUM: "You need at least R50 available to request a payout.",
  PAYOUT_DETAILS_MISSING: "Add your PayShap or bank details first.",
  PAYOUT_REFERENCE_REQUIRED: "Enter the PayShap or bank reference.",
  PAYOUT_NOT_FOUND: "That payout request wasn't found.",
  PAYOUT_NOT_OPEN: "That payout request is no longer open.",
  REFUND_TRIP_NOT_FOUND: "We couldn't find that trip.",
  REFUND_TRIP_NOT_CANCELLED: "Refunds can only be requested for cancelled trips.",
  REFUND_NO_CARD_PAYMENT: "This trip has no card payment to refund.",
  REFUND_NOT_FOUND: "That refund request wasn't found.",
  REFUND_REFERENCE_REQUIRED: "Enter the refund payment reference.",
};

/** Turns a database exception into a friendly message (never leaks raw SQL errors). */
export function payoutRpcError(error: { message?: string } | null | undefined) {
  const message = String(error?.message ?? "");
  const code = Object.keys(RPC_MESSAGES).find(key => message.includes(key));
  return code
    ? { code, message: RPC_MESSAGES[code], status: 409 }
    : { code: "UNAVAILABLE", message: "This is unavailable right now. Please try again.", status: 503 };
}
