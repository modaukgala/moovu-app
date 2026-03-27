export function calculateCommission(fareAmount: number, commissionPct = 5) {
  const fare = Number(fareAmount || 0);
  const pct = Number(commissionPct || 0);

  if (!Number.isFinite(fare) || fare <= 0) {
    return {
      fareAmount: 0,
      commissionPct: pct,
      commissionAmount: 0,
      driverNet: 0,
    };
  }

  const commissionAmount = Math.round((fare * (pct / 100)) * 100) / 100;
  const driverNet = Math.round((fare - commissionAmount) * 100) / 100;

  return {
    fareAmount: fare,
    commissionPct: pct,
    commissionAmount,
    driverNet,
  };
}