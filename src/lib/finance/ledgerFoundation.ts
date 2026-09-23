import { createHash } from "node:crypto";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { positiveZarCents, type ZarCents } from "./money.ts";

export const PHASE1_LEDGER_WRITE_ENABLED = false;
export const PHASE1_LEDGER_READ_ENABLED = false;

export type LedgerSide = "DEBIT" | "CREDIT";
export type LedgerEntryDraft = {
  accountCode: string;
  side: LedgerSide;
  amountCents: ZarCents;
};

export function ledgerEntry(accountCode: string, side: LedgerSide, amountCents: bigint): LedgerEntryDraft {
  const code = accountCode.trim();
  if (!code) throw new Error("Ledger account code is required.");
  if (side !== "DEBIT" && side !== "CREDIT") throw new Error("Ledger side must be DEBIT or CREDIT.");
  return { accountCode: code, side, amountCents: positiveZarCents(amountCents) };
}

export function assertBalancedEntries(entries: readonly LedgerEntryDraft[]) {
  if (entries.length < 2) throw new Error("A financial transaction requires at least two entries.");
  const debitCents = entries.filter((entry) => entry.side === "DEBIT")
    .reduce((sum, entry) => sum + entry.amountCents, BigInt(0));
  const creditCents = entries.filter((entry) => entry.side === "CREDIT")
    .reduce((sum, entry) => sum + entry.amountCents, BigInt(0));
  if (debitCents !== creditCents) throw new Error("Ledger transaction is not balanced.");
  return { debitCents, creditCents };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]));
  }
  return typeof value === "bigint" ? value.toString() : value;
}

export function financialPayloadHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(payload))).digest("hex");
}

export function financialIdempotencyKey(type: string, sourceId: string): string {
  const normalizedType = type.trim().toLowerCase();
  const normalizedSource = sourceId.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(normalizedType) || !normalizedSource) {
    throw new Error("A stable transaction type and source ID are required.");
  }
  return `${normalizedType}:${normalizedSource}`;
}
