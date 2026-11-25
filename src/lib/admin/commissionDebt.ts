const fields = ["balance_due", "total_commission", "total_driver_net", "total_trips_completed", "total_settled", "cancellation_credits"] as const;

export async function readCommissionDebt(
  rpc: (name: "phase05b_driver_debt", args: { p_driver_id: string }) => PromiseLike<{ data: unknown; error: unknown }>,
  driverId: string,
) {
  const { data, error } = await rpc("phase05b_driver_debt", { p_driver_id: driverId });
  const debt = data as Record<(typeof fields)[number], number> & { driver_id: string } | null;
  if (error || debt?.driver_id !== driverId || fields.some((key) => !Number.isFinite(debt[key]))) {
    throw new Error("Authoritative commission balance is unavailable.");
  }
  return debt;
}
