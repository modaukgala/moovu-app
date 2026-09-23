type SnapshotTrip = { commission_pct: number | null; commission_amount: number | null; driver_net_earnings: number | null };
type SnapshotTransaction = { driver_id: string; amount: number; direction: string; meta: unknown };

/** Never derive an already-posted charge from today's pricing configuration. */
export function readCommissionSnapshot(driverId: string, trip: SnapshotTrip, transaction: SnapshotTransaction) {
  const meta = transaction.meta && typeof transaction.meta === "object"
    ? transaction.meta as Record<string, unknown> : {};
  const fare = meta.fare_amount;
  const pct = meta.commission_pct;
  const net = meta.driver_net;
  const amount = Number(transaction.amount);
  const close = (a: number, b: number) => Math.abs(a - b) < 0.005;
  if (transaction.driver_id !== driverId || transaction.direction !== "debit"
    || typeof fare !== "number" || !Number.isFinite(fare) || fare <= 0
    || typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100
    || typeof net !== "number" || !Number.isFinite(net) || net < 0
    || !Number.isFinite(amount) || amount < 0
    || !close(amount, Math.round(fare * pct) / 100)
    || !close(net, Math.round((fare - amount) * 100) / 100)
    || trip.commission_pct == null || !close(Number(trip.commission_pct), pct)
    || trip.commission_amount == null || !close(Number(trip.commission_amount), amount)
    || trip.driver_net_earnings == null || !close(Number(trip.driver_net_earnings), net)) {
    return { ok: false as const, error: "Commission history requires reconciliation. No financial values were changed." };
  }
  return { ok: true as const, calc: { fareAmount: fare, commissionPct: pct, commissionAmount: amount, driverNet: net } };
}
