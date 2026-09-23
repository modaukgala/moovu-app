import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { PHASE2_CONTRACT_VERSION } from "../finance/phase2Policy.ts";

export type Phase2RpcResult<T extends Record<string, unknown>> =
  | { ok: true; result: T & { contract_version: typeof PHASE2_CONTRACT_VERSION } }
  | { ok: false; status: 409 | 500 | 503; code: "contract_unavailable" | "contract_incompatible" | "operation_rejected" | "operation_failed"; error: string };

function isUnavailable(error: PostgrestError) {
  const text = `${error.message} ${error.details ?? ""}`.toLowerCase();
  return ["PGRST202", "42883"].includes(error.code) || text.includes("does not exist") || text.includes("could not find the function");
}

export async function callPhase2Rpc<T extends Record<string, unknown>>(
  client: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<Phase2RpcResult<T>> {
  const { data, error } = await client.rpc(functionName, args);
  if (error) {
    if (isUnavailable(error)) return { ok: false, status: 503, code: "contract_unavailable", error: "Phase 2 database contract is unavailable. No changes were made." };
    if (["P0001", "23505", "23514", "42501"].includes(error.code)) return { ok: false, status: 409, code: "operation_rejected", error: error.message };
    console.error("[phase2-finance] protected RPC failed", { functionName, code: error.code, message: error.message });
    return { ok: false, status: 500, code: "operation_failed", error: "The financial operation could not be completed safely." };
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result !== "object" || result.contract_version !== PHASE2_CONTRACT_VERSION) {
    return { ok: false, status: 503, code: "contract_incompatible", error: "Phase 2 database contract version is unsupported. No changes were made." };
  }
  return { ok: true, result: result as T & { contract_version: typeof PHASE2_CONTRACT_VERSION } };
}
