import type { SupabaseClient } from "@supabase/supabase-js";
import { callPhase2Rpc, type Phase2RpcResult } from "@/lib/server/phase2Rpc";

export const PHASE2_SHADOW_RECOVERY_MAX_ATTEMPTS = 8;

export type Phase2ShadowRecoveryJob = {
  id: string;
  operation_key: string;
  trip_id: string;
  actor_id: string | null;
  status: "pending" | "processing" | "retryable_failure" | "succeeded" | "terminal_failure";
  attempts: number;
};

type PostingResult = Record<string, unknown> & {
  transaction_id?: string;
  replayed?: boolean;
};

export function phase2RecoveryFailure(result: Extract<Phase2RpcResult<PostingResult>, { ok: false }>) {
  const retryable = result.code === "contract_unavailable" || result.code === "operation_failed";
  return { retryable, code: result.code, message: result.error };
}

export async function processPhase2ShadowRecoveryJob(
  client: SupabaseClient,
  job: Phase2ShadowRecoveryJob,
) {
  try {
    const posting = await callPhase2Rpc<PostingResult>(client, "phase2_post_trip_commission", {
      p_trip_id: job.trip_id,
      p_actor_id: job.actor_id,
    });
    if (!posting.ok) {
      const failure = phase2RecoveryFailure(posting);
      await finish(client, job.id, false, failure.retryable, failure.code, failure.message);
      return { ok: false as const, ...failure };
    }
    await finish(client, job.id, true, false, null, null);
    return {
      ok: true as const,
      transactionId: typeof posting.result.transaction_id === "string" ? posting.result.transaction_id : null,
      replayed: posting.result.replayed === true,
    };
  } catch {
    await finish(client, job.id, false, true, "transport_failure", "Temporary transport failure.");
    return { ok: false as const, retryable: true, code: "transport_failure", message: "Temporary transport failure." };
  }
}

async function finish(
  client: SupabaseClient,
  jobId: string,
  succeeded: boolean,
  retryable: boolean,
  errorCode: string | null,
  errorMessage: string | null,
) {
  const result = await callPhase2Rpc(client, "phase2_finish_shadow_recovery_job", {
    p_job_id: jobId,
    p_succeeded: succeeded,
    p_retryable: retryable,
    p_error_code: errorCode,
    p_error_message: errorMessage,
  });
  if (!result.ok) throw new Error("Phase 2 recovery acknowledgement failed.");
}
