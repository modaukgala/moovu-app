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
