import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushSafe } from "@/lib/push-server";
import { PHASE6_EVIDENCE_LABELS } from "@/lib/drivers/phase6ReviewPresentation";
import {
  isOutboxDeliveryEnabled,
  isOutboxWorkerAuthorized,
  phase6InAppHistoryRow,
  processOutboxJob,
  type OutboxJob,
  type OutboxNotificationIntent,
} from "@/lib/notifications/outboxDelivery";

type Recipient = { userId: string; role: "customer" | "driver" | "admin" };

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function resolveRecipients(job: OutboxJob): Promise<Recipient[]> {
  const recipients = new Map<string, Recipient>();
  const add = (userId: unknown, role: Recipient["role"]) => {
    const id = text(userId);
    if (id) recipients.set(`${role}:${id}`, { userId: id, role });
  };
  const driverId = text(job.payload.driver_id);
  const tripId = text(job.payload.trip_id);
  const applicationId = text(job.payload.application_id);
  const directUserId = text(job.payload.user_id);

  if (directUserId) add(directUserId, "driver");

  if (driverId) {
    const { data } = await supabaseAdmin.from("driver_accounts").select("user_id").eq("driver_id", driverId).maybeSingle();
    add(data?.user_id, "driver");
  }
  if (applicationId) {
    const { data } = await supabaseAdmin.from("driver_applications").select("user_id").eq("id", applicationId).maybeSingle();
    add(data?.user_id, "driver");
  }
  if (tripId) {
    const { data: trip } = await supabaseAdmin.from("trips").select("customer_id,driver_id").eq("id", tripId).maybeSingle();
    if (trip?.customer_id) {
      const { data: customer } = await supabaseAdmin.from("customers").select("auth_user_id").eq("id", trip.customer_id).maybeSingle();
      add(customer?.auth_user_id, "customer");
    }
    if (trip?.driver_id && !driverId) {
      const { data: account } = await supabaseAdmin.from("driver_accounts").select("user_id").eq("driver_id", trip.driver_id).maybeSingle();
      add(account?.user_id, "driver");
    }
  }
  if (job.event_type === "driver_application_submitted") {
    const { data } = await supabaseAdmin.from("profiles").select("id").in("role", ["owner", "admin"]);
    for (const row of data ?? []) add(row.id, "admin");
  }
  return [...recipients.values()];
}

function intentFor(job: OutboxJob, recipient: Recipient): OutboxNotificationIntent {
  const tripId = text(job.payload.trip_id);
  const requestId = text(job.payload.request_id);
  const requirementLabel = PHASE6_EVIDENCE_LABELS[text(job.payload.requirement)] ?? "Driver application evidence";
  const reasonCategory = ["Image is blurry", "Document or photo is cut off", "Information cannot be read", "Wrong document or photo", "Document has expired", "Incorrect angle or view", "Other"].includes(text(job.payload.reason_category)) ? text(job.payload.reason_category) : "Review requested";
  const templates: Record<string, { title: string; body: string }> = {
    phase6_correction_requested: { title: "Application evidence needs attention", body: `${requirementLabel}: ${reasonCategory}. Open your application to replace it.` },
    phase6_application_approved: { title: "Driver application approved", body: "Your MOOVU Driver application is approved. You can go online when otherwise eligible." },
    phase6_application_rejected: { title: "Driver application decision", body: "Your Driver application was not approved. Open your application for the review reason." },
    driver_application_submitted: { title: "New driver application", body: "A driver application is ready for review." },
    driver_application_approved: { title: "Driver application approved", body: "Your MOOVU driver application was approved." },
    payment_reviewed: { title: "Payment review updated", body: "Your MOOVU payment review has been updated." },
    driver_settlement_recorded: { title: "Commission payment recorded", body: "Your MOOVU commission payment was recorded." },
    driver_subscription_activated: { title: "Subscription activated", body: "Your MOOVU driver subscription is active." },
    driver_subscription_payment_recorded: { title: "Subscription payment recorded", body: "Your subscription payment was recorded." },
    driver_subscription_updated: { title: "Subscription updated", body: "Your MOOVU subscription was updated." },
    trip_assigned: { title: "Driver assigned", body: "A driver has been assigned to this trip." },
    trip_arrived: { title: "Driver arrived", body: "The driver has arrived at the pickup point." },
    trip_completed: { title: "Trip completed", body: "The trip was completed successfully." },
    trip_cancelled: { title: "Trip cancelled", body: "This trip has been cancelled." },
    customer_no_show: { title: "Trip marked no-show", body: "This trip was recorded as a customer no-show." },
    trip_cancelled_admin: { title: "Trip cancelled", body: "MOOVU cancelled this trip." },
    trip_cancelled_driver: { title: "Trip cancelled", body: "The driver cancelled this trip." },
  };
  const template = templates[job.event_type] ?? {
    title: "MOOVU update",
    body: "There is an update to your MOOVU account.",
  };
  const url = recipient.role === "admin" ? "/admin/notifications"
    : recipient.role === "driver" ? (job.event_type.startsWith("phase6_") ? `/driver/onboarding${text(job.payload.requirement) ? `?requirement=${encodeURIComponent(text(job.payload.requirement))}` : ""}` : requestId ? `/driver/payment-receipts/${requestId}` : "/driver")
      : tripId ? `/ride/${tripId}` : "/";
  return {
    ...recipient,
    ...template,
    url,
    data: { eventKey: job.business_event_id, type: job.event_type, tripId: tripId || undefined,
      applicationId: job.event_type.startsWith("phase6_") ? text(job.payload.application_id) : undefined,
      reviewId: job.event_type.startsWith("phase6_") ? text(job.payload.review_id) : undefined,
      requirement: job.event_type.startsWith("phase6_") ? text(job.payload.requirement) : undefined,
      cycle: job.event_type.startsWith("phase6_") ? text(job.payload.cycle) : undefined,
      version: job.event_type.startsWith("phase6_") ? text(job.payload.version) : undefined },
  };
}

export async function POST(req: Request) {
  if (!isOutboxWorkerAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized outbox worker." }, { status: 401 });
  }
  if (!isOutboxDeliveryEnabled()) {
    return NextResponse.json({ ok: false, error: "Outbox delivery is not activated." }, { status: 503 });
  }
  const body = await req.json().catch(() => ({})) as { jobIds?: unknown };
  const jobIds = body.jobIds;
  if (!Array.isArray(jobIds) || jobIds.length < 1 || jobIds.length > 3 ||
      jobIds.some((id) => typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    return NextResponse.json({ ok: false, error: "Reviewed job IDs are required." }, { status: 400 });
  }
  // No general backlog claim: each invocation can only take reviewed Phase 6 IDs.
  const { data, error } = await supabaseAdmin.rpc("phase6_claim_review_outbox", { p_ids: jobIds });
  if (error) return NextResponse.json({ ok: false, error: "Outbox contract is unavailable." }, { status: 503 });

  const results = [];
  for (const job of (data ?? []) as OutboxJob[]) {
    results.push(await processOutboxJob(job, {
      resolveIntents: async (claimed) => (await resolveRecipients(claimed)).map((recipient) => intentFor(claimed, recipient)),
      send: async (intent, eventKey) => {
        if (job.event_type.startsWith("phase6_")) {
          const { error: historyError } = await supabaseAdmin.from("app_notifications")
            .upsert(phase6InAppHistoryRow(intent, eventKey), { onConflict: "user_id,event_key", ignoreDuplicates: true });
          if (historyError) throw new Error("Phase 6 in-app notification could not be recorded.");
        }
        const [fcm, web] = await Promise.all([
          supabaseAdmin.from("fcm_tokens").select("id", { count: "exact", head: true })
            .eq("user_id", intent.userId).eq("role", intent.role).eq("is_active", true).eq("enabled", true),
          supabaseAdmin.from("push_subscriptions").select("id", { count: "exact", head: true })
            .eq("user_id", intent.userId).eq("role", intent.role),
        ]);
        if (fcm.error || web.error) throw new Error("Push target inspection failed.");
        const hasRegisteredTarget = (fcm.count ?? 0) + (web.count ?? 0) > 0;
        const result = await sendPushSafe({
          userIds: [intent.userId], role: intent.role, title: intent.title, body: intent.body,
          url: intent.url, data: intent.data, notificationEventKey: eventKey,
        });
        if (hasRegisteredTarget && result.delivered === 0 && result.failed === 0) {
          return { ok: false, failed: 1, message: "No push provider accepted a registered target." };
        }
        return result;
      },
      finish: async (jobId, delivered, finishError) => {
        const { error: rpcError } = await supabaseAdmin.rpc("phase05b_finish_outbox", {
          p_id: jobId, p_delivered: delivered, p_error: finishError,
        });
        if (rpcError) throw new Error("Outbox acknowledgement failed.");
      },
    }));
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}
