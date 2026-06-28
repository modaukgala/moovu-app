import type { SupabaseClient } from "@supabase/supabase-js";

export type DispatchJobType = "escalate" | "expire" | "recover" | "release_scheduled";

export function isDispatchWorkerAuthorized(req: Request) {
  const configured = process.env.DISPATCH_JOB_SECRET?.trim();
  if (!configured) return false;
  const authorization = req.headers.get("authorization") ?? "";
  const explicit = req.headers.get("x-dispatch-job-secret") ?? "";
  return authorization === `Bearer ${configured}` || explicit === configured;
}

export async function enqueueDispatchJob(params: {
  supabase: SupabaseClient;
  tripId: string;
  jobType: DispatchJobType;
  runAt: string;
  offerId?: string | null;
  dispatchCycle?: number;
  sequenceNumber?: number;
}) {
  const { error } = await params.supabase.from("dispatch_jobs").upsert(
    {
      trip_id: params.tripId,
      offer_id: params.offerId ?? null,
      job_type: params.jobType,
      run_at: params.runAt,
      dispatch_cycle: params.dispatchCycle ?? 1,
      sequence_number: params.sequenceNumber ?? 1,
      status: "pending",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "trip_id,job_type,dispatch_cycle,sequence_number" },
  );

  if (error) {
    console.error("[dispatch-scheduler] could not enqueue durable job", {
      tripId: params.tripId,
      jobType: params.jobType,
      reason: error.message,
    });
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const };
}

