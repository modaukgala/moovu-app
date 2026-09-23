export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_STALE_CLAIM_MINUTES = 5;

export type OutboxJob = {
  id: string;
  business_event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export type OutboxNotificationIntent = {
  userId: string;
  role: "customer" | "driver" | "admin";
  title: string;
  body: string;
  url: string;
  data: Record<string, string | number | boolean | null | undefined>;
};

export type OutboxPushResult = { ok: boolean; failed: number; message?: string };

export function isOutboxWorkerAuthorized(req: Request) {
  const configured = process.env.OUTBOX_JOB_SECRET?.trim();
  if (!configured) return false;
  const authorization = req.headers.get("authorization") ?? "";
  const explicit = req.headers.get("x-outbox-job-secret") ?? "";
  return authorization === `Bearer ${configured}` || explicit === configured;
}

export function isOutboxDeliveryEnabled() {
  return process.env.PHASE05_OUTBOX_ENABLED === "true";
}

export function outboxNotificationEventKey(businessEventId: string, userId: string) {
  return `phase05:${businessEventId}:${userId}`;
}

export async function processOutboxJob(
  job: OutboxJob,
  dependencies: {
    resolveIntents: (job: OutboxJob) => Promise<OutboxNotificationIntent[]>;
    send: (intent: OutboxNotificationIntent, eventKey: string) => Promise<OutboxPushResult>;
    finish: (jobId: string, delivered: boolean, error: string | null) => Promise<void>;
  },
) {
  try {
    if (!Number.isInteger(job.attempts) || job.attempts < 1 || job.attempts > OUTBOX_MAX_ATTEMPTS) {
      throw new Error("Outbox claim contract is invalid or exhausted.");
    }
    const intents = await dependencies.resolveIntents(job);
    if (intents.length === 0) throw new Error(`No notification target for ${job.event_type}.`);

    for (const intent of intents) {
      const result = await dependencies.send(
        intent,
        outboxNotificationEventKey(job.business_event_id, intent.userId),
      );
      if (!result.ok || result.failed > 0) {
        throw new Error(result.message || "Push delivery failed.");
      }
    }
    await dependencies.finish(job.id, true, null);
    return { ok: true as const };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Outbox delivery failed.";
    await dependencies.finish(job.id, false, message);
    return { ok: false as const, error: message };
  }
}
