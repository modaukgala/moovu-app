/** Legacy automated payouts remain independently disabled. */
export function onlinePayoutsAvailable(): boolean {
  return process.env.MOOVU_ONLINE_PAYOUTS_ENABLED === "true";
}

export function payoutVisibilityAvailable(): boolean {
  return process.env.MOOVU_PAYOUT_VISIBILITY_ENABLED === "true";
}

/** Admin payout writes still require the reviewed database policy. */
export function manualPayoutsAvailable(): boolean {
  return process.env.MOOVU_MANUAL_PAYOUTS_ENABLED === "true";
}

export function onlinePayablePostingAvailable(): boolean {
  return process.env.MOOVU_ONLINE_PAYABLE_POSTING_ENABLED === "true";
}

export function bankVerificationAvailable(): boolean {
  return process.env.MOOVU_PAYOUT_BANK_VERIFICATION_ENABLED === "true";
}

export function payoutActionAllowed(action: string): boolean {
  if (!payoutVisibilityAvailable() || !manualPayoutsAvailable()) return false;
  if (action === "VERIFY_MANUAL_PAYMENT" || action === "SETTLE_DEBT_ONLY") {
    return bankVerificationAvailable();
  }
  return true;
}
