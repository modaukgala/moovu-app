import type { SupabaseClient } from "@supabase/supabase-js";

const NAMES = new Set([
  "phase4b_quote_customer_cancellation", "phase4b_cancel_customer_trip",
  "phase4b_mark_customer_no_show", "phase4b_expire_dispatch_trip",
  "phase4b_cancel_trip_operational", "phase4b_reverse_unpaid_assessment",
  "phase4_customer_debt_state", "phase4_admin_liability_action",
]);

/** Phase 4 functions have their own JSON contracts, distinct from Phase 05B's versioned RPCs. */
export async function callPhase4Rpc<T extends Record<string, unknown>>(
  client: SupabaseClient, name: string, args: Record<string, unknown>,
  isResult: (value: Record<string, unknown>) => boolean,
): Promise<{ ok: true; result: T } | { ok: false; status: 409 | 500 | 503; code: string; error: string }> {
  if (!NAMES.has(name)) throw new Error("Unsupported Phase 4 database contract.");
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const unavailable = error.code === "PGRST202" || error.code === "42883";
    return { ok: false, status: unavailable ? 503 : error.code === "P0001" ? 409 : 500,
      code: unavailable ? "contract_unavailable" : error.code === "P0001" ? "operation_rejected" : "operation_failed",
      error: unavailable ? "Phase 4 database contract is unavailable."
        : error.code === "P0001" ? error.message : "Phase 4 operation could not complete safely." };
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result !== "object" || !isResult(result as Record<string, unknown>)) {
    return { ok: false, status: 503, code: "contract_incompatible", error: "Phase 4 database response is unsupported." };
  }
  return { ok: true, result: result as T };
}
