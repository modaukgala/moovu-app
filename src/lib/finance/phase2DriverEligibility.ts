import type { SupabaseClient } from "@supabase/supabase-js";
import { phase2Mode, type Phase2Mode } from "@/lib/finance/phase2Policy";

type DriverFinanceInput = {
  driverId: string;
  subscriptionStatus?: string | null;
  subscriptionExpiresAt?: string | null;
  legacyBalanceDue?: number | null;
};

export type DriverFinanceAuthority = {
  mode: Phase2Mode;
  configuredMode: Phase2Mode;
  debtCents: number;
  unappliedCreditCents: number;
  netOwedCents: number;
  thresholdCents: number;
  financiallyEligible: boolean;
  subscriptionRequired: boolean;
  asOf: string;
  policyId: string | null;
  authoritativeEffectiveFrom: string | null;
};

export async function resolveDriverFinanceAuthority(
  client: SupabaseClient,
  input: DriverFinanceInput,
): Promise<{ ok: true; authority: DriverFinanceAuthority } | { ok: false; code: "mode_mismatch" | "contract_unavailable"; error: string }> {
  const applicationMode = phase2Mode();
  const policyResult = await client.rpc("phase2_current_policy");
  const policy = Array.isArray(policyResult.data) ? policyResult.data[0] : policyResult.data;
  if (policyResult.error || !policy || typeof policy.mode !== "string") {
    return { ok: false, code: "contract_unavailable", error: "Phase 2 policy authority is unavailable." };
  }
  const configuredMode = policy.mode as Phase2Mode;
  const authoritativeEffectiveFrom = typeof policy.authoritative_effective_from === "string"
    ? policy.authoritative_effective_from : null;
  const pendingAuthoritative = configuredMode === "AUTHORITATIVE" && authoritativeEffectiveFrom != null &&
    new Date(authoritativeEffectiveFrom).getTime() > Date.now();
  const effectiveMode: Phase2Mode = pendingAuthoritative ? "SHADOW" : configuredMode;
  const modesAgree = applicationMode === configuredMode || (pendingAuthoritative && applicationMode === "SHADOW");
  if (!modesAgree) {
    return { ok: false, code: "mode_mismatch", error: "Application and database Phase 2 modes do not agree." };
  }
  const thresholdCents = Number(policy.debt_limit_cents ?? 5000);
  if (effectiveMode === "AUTHORITATIVE") {
    const positionResult = await client.rpc("phase2_finance_eligibility", { p_driver_id: input.driverId });
    const position = Array.isArray(positionResult.data) ? positionResult.data[0] : positionResult.data;
    if (positionResult.error || !position || typeof position.financially_eligible !== "boolean") {
      return { ok: false, code: "contract_unavailable", error: "Authoritative Driver finance position is unavailable." };
    }
    return { ok: true, authority: {
      mode: effectiveMode,
      configuredMode,
      debtCents: Number(position.commission_debt_cents ?? 0),
      unappliedCreditCents: Number(position.unapplied_credit_cents ?? 0),
      netOwedCents: Number(position.net_owed_cents ?? 0),
      thresholdCents,
      financiallyEligible: position.financially_eligible,
      subscriptionRequired: false,
      asOf: new Date().toISOString(),
      policyId: typeof policy.id === "string" ? policy.id : null,
      authoritativeEffectiveFrom,
    } };
  }
  const expiry = input.subscriptionExpiresAt ? new Date(input.subscriptionExpiresAt).getTime() : 0;
  const subscribed = ["active", "grace"].includes(String(input.subscriptionStatus ?? "").toLowerCase()) && expiry > Date.now();
  const debtCents = Math.max(0, Math.round(Number(input.legacyBalanceDue ?? 0) * 100));
  return { ok: true, authority: {
    mode: effectiveMode,
    configuredMode,
    debtCents,
    unappliedCreditCents: 0,
    netOwedCents: debtCents,
    thresholdCents: 10000,
    financiallyEligible: subscribed && debtCents < 10000,
    subscriptionRequired: true,
    asOf: new Date().toISOString(),
    policyId: typeof policy.id === "string" ? policy.id : null,
    authoritativeEffectiveFrom,
  } };
}
