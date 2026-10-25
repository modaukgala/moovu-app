export type CommissionAuthority = {
  mode: string;
  netOwedCents: number;
};

export function commissionDueAmount(
  authority: CommissionAuthority | null | undefined,
  legacyBalance: number | null | undefined,
): number {
  if (authority && Number.isFinite(authority.netOwedCents)) {
    return authority.netOwedCents / 100;
  }
  return Number.isFinite(legacyBalance) ? Number(legacyBalance) : 0;
}

export function commissionDebtNotice(amountRand: number): string | null {
  if (!Number.isFinite(amountRand) || amountRand < 40) return null;
  if (amountRand >= 50) return "Your commission balance is R50 or more. This does not automatically block trips or take you offline.";
  return "Your commission balance has reached R40. Please review your balance and payment options.";
}
