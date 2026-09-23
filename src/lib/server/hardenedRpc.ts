import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export const PHASE_05B_CONTRACT_VERSION = "phase-05b-v1";

export type HardenedRpcFailure = {
  ok: false;
  status: 409 | 500 | 503;
  code: "contract_unavailable" | "contract_incompatible" | "operation_rejected" | "operation_failed";
  error: string;
  referenceId?: string;
};

export type HardenedRpcSuccess<T extends Record<string, unknown>> = {
  ok: true;
  result: T & { contract_version: typeof PHASE_05B_CONTRACT_VERSION };
};

function unavailable(error: PostgrestError) {
  const message = `${error.message} ${error.details ?? ""}`.toLowerCase();
  return error.code === "PGRST202" || error.code === "42883"
    || message.includes("could not find the function") || message.includes("does not exist");
}

/**
 * Invoke a database transaction contract without a legacy write fallback.
 * Callers must use a trusted server client; the hardened functions are not
 * executable by anon/authenticated roles.
 */
export async function callHardenedRpc<T extends Record<string, unknown>>(
  client: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<HardenedRpcSuccess<T> | HardenedRpcFailure> {
  const { data, error } = await client.rpc(functionName, args);
  if (error) {
    if (unavailable(error)) {
      return {
        ok: false,
        status: 503,
        code: "contract_unavailable",
        error: "Required hardened database contract is unavailable. No changes were made.",
      };
    }
    if (error.code === "P0001" || error.code === "23505" || error.code === "23514") {
      return { ok: false, status: 409, code: "operation_rejected", error: error.message };
    }
    const referenceId = randomUUID().slice(0, 8).toUpperCase();
    console.error("[hardened-rpc] database operation failed", {
      referenceId,
      functionName,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return {
      ok: false,
      status: 500,
      code: "operation_failed",
      referenceId,
      error: `We could not safely complete this action. Try again. If it continues, contact MOOVU support with code ${referenceId}.`,
    };
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result !== "object" || result.contract_version !== PHASE_05B_CONTRACT_VERSION) {
    return {
      ok: false,
      status: 503,
      code: "contract_incompatible",
      error: "Hardened database contract version is unsupported. No changes were made.",
    };
  }
  return { ok: true, result: result as T & { contract_version: typeof PHASE_05B_CONTRACT_VERSION } };
}
