import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPushSafe } from "@/lib/push-server";
import {
  isOutboxDeliveryEnabled,
  isOutboxWorkerAuthorized,
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
  const templates: Record<string, { title: string; body: string }> = {
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
    : recipient.role === "driver" ? (requestId ? `/driver/payment-receipts/${requestId}` : "/driver")
      : tripId ? `/ride/${tripId}` : "/";
  return {
    ...recipient,
    ...template,
    url,
    data: { eventKey: job.business_event_id, type: job.event_type, tripId: tripId || undefined },
  };
}

export async function POST(req: Request) {
  if (!isOutboxWorkerAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized outbox worker." }, { status: 401 });
  }
  if (!isOutboxDeliveryEnabled()) {
    return NextResponse.json({ ok: false, error: "Outbox delivery is not activated." }, { status: 503 });
  }
  const body = await req.json().catch(() => ({})) as { limit?: number };
  const limit = Math.min(50, Math.max(1, Number(body.limit ?? 20)));
  const { data, error } = await supabaseAdmin.rpc("phase05b_claim_outbox", { p_limit: limit });
  if (error) return NextResponse.json({ ok: false, error: "Outbox contract is unavailable." }, { status: 503 });

  const results = [];
  for (const job of (data ?? []) as OutboxJob[]) {
    results.push(await processOutboxJob(job, {
      resolveIntents: async (claimed) => (await resolveRecipients(claimed)).map((recipient) => intentFor(claimed, recipient)),
      send: async (intent, eventKey) => sendPushSafe({
        userIds: [intent.userId], role: intent.role, title: intent.title, body: intent.body,
        url: intent.url, data: intent.data, notificationEventKey: eventKey,
      }),
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
