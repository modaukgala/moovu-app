export const PHASE2_CONTRACT_VERSION = "phase-2-v1" as const;
export const PHASE2_COMMISSION_BASIS_POINTS = BigInt(1500);
export const PHASE2_COMMISSION_DEBT_LIMIT_CENTS = BigInt(5000);
export const PHASE2_COMMISSION_WARNING_CENTS = BigInt(4000);

export type Phase2Mode = "OFF" | "SHADOW" | "AUTHORITATIVE";

export function phase2Mode(value = process.env.MOOVU_PHASE2_FINANCE_MODE): Phase2Mode {
  const normalized = String(value ?? "OFF").trim().toUpperCase();
  return normalized === "SHADOW" || normalized === "AUTHORITATIVE" ? normalized : "OFF";
}

export function phase2WritesEnabled(mode = phase2Mode()) {
  return mode === "SHADOW" || mode === "AUTHORITATIVE";
}

export function phase2IsAuthoritative(mode = phase2Mode()) {
  return mode === "AUTHORITATIVE";
}

export function calculateCommissionCents(fareCents: bigint, basisPoints = PHASE2_COMMISSION_BASIS_POINTS) {
  if (fareCents < BigInt(0)) throw new Error("Fare cannot be negative.");
  if (basisPoints < BigInt(0) || basisPoints > BigInt(10_000)) throw new Error("Commission basis points are invalid.");
  return (fareCents * basisPoints + BigInt(5_000)) / BigInt(10_000);
}

export function phase2FinanceState(debtCents: bigint) {
  const normalized = debtCents > BigInt(0) ? debtCents : BigInt(0);
  return {
    debtCents: normalized,
    eligible: normalized < PHASE2_COMMISSION_DEBT_LIMIT_CENTS,
    warning: normalized >= PHASE2_COMMISSION_WARNING_CENTS,
    restricted: normalized >= PHASE2_COMMISSION_DEBT_LIMIT_CENTS,
    remainingCents: normalized >= PHASE2_COMMISSION_DEBT_LIMIT_CENTS
      ? BigInt(0)
      : PHASE2_COMMISSION_DEBT_LIMIT_CENTS - normalized,
  };
}

export function phase2RequiresSubscription(mode = phase2Mode()) {
  return mode !== "AUTHORITATIVE";
}
