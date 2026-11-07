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

/** A missing or ambiguous activation boundary must never admit payout posting. */
export function payoutEffectiveAt(environment: Record<string, string | undefined> = process.env): string | null {
  const value = environment.MOOVU_PAYOUT_EFFECTIVE_AT?.trim();
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== value.slice(0, 19)
    ? null : parsed.toISOString();
}

/** Option B is a separate forward-only version; an absent value leaves every existing payout on its current policy. */
export function optionBEffectiveAt(environment: Record<string, string | undefined> = process.env): string | null {
  const value = environment.MOOVU_OPTION_B_PAYOUT_EFFECTIVE_AT?.trim();
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== value.slice(0, 19)
    ? null : parsed.toISOString();
}

export function payoutActivationMatches(configured: string | null, recorded: string | null): boolean {
  return configured !== null && recorded !== null && Number.isFinite(Date.parse(recorded)) &&
    Date.parse(configured) === Date.parse(recorded);
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
