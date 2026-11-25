export type PersistedAllocation = {
  status?: string | null;
  contract_version?: string | null;
  subscription_amount_applied?: number | null;
  commission_amount_applied?: number | null;
  unapplied_excess?: number | null;
};

export function recordedAllocation(row: PersistedAllocation) {
  const amount = (value: number | null | undefined) =>
    row.status === "approved" && row.contract_version && typeof value === "number" && Number.isFinite(value) ? value : null;
  return { subscription: amount(row.subscription_amount_applied), commission: amount(row.commission_amount_applied),
    excess: amount(row.unapplied_excess) };
}
