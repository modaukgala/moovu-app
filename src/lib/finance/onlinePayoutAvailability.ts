/** Both the application gate and reviewed database policy are required for mutations. */
export function onlinePayoutsAvailable(): boolean {
  return process.env.MOOVU_ONLINE_PAYOUTS_ENABLED === "true";
}

/** Manual payout records and payable calculation never initiate bank transfers. */
export function manualPayoutsAvailable(): boolean {
  return process.env.MOOVU_MANUAL_PAYOUTS_ENABLED === "true";
}
