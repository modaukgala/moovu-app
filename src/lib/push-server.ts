import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import type { PushRole } from "@/lib/push-auth";

type SendPushParams = {
  userIds?: string[];
  role?: PushRole;
  title: string;
  body: string;
  url?: string;
};

type PushFailure = {
  subscriptionId: string;
  reason: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getPushErrorDetails(error: unknown) {
  const record = typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)
    : {};
  const statusCode =
    typeof record.statusCode === "number" ? record.statusCode : undefined;
  const body = typeof record.body === "string" ? record.body : null;
  const message = getErrorMessage(error);

  return {
    statusCode,
    reason: body || message || `Push failed with status ${String(statusCode || "unknown")}`,
  };
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function ensureVapidConfigured() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@moovurides.co.za";

  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys are missing.");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function sendPushToTargets(params: SendPushParams) {
  ensureVapidConfigured();

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("push_subscriptions")
    .select("id,user_id,role,endpoint,subscription");

  if (params.userIds && params.userIds.length > 0) {
    query = query.in("user_id", params.userIds);
  }

  if (params.role) {
    query = query.eq("role", params.role);
  }

  if ((!params.userIds || params.userIds.length === 0) && !params.role) {
    throw new Error("No push target was supplied.");
  }

  const { data: subscriptions, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  if (!subscriptions || subscriptions.length === 0) {
    return {
      ok: true,
      delivered: 0,
      removed: 0,
      failed: 0,
      failures: [],
      message: "No matching push subscriptions were found.",
    };
  }

  const payload = JSON.stringify({
    title: params.title,
    body: params.body,
    url: params.url || "/",
  });

  let delivered = 0;
  let removed = 0;
  let failed = 0;
  const failures: PushFailure[] = [];

  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(
        row.subscription as webpush.PushSubscription,
        payload
      );
      delivered += 1;
    } catch (error: unknown) {
      const { statusCode, reason } = getPushErrorDetails(error);

      failed += 1;
      failures.push({
        subscriptionId: String(row.id),
        reason,
      });

      console.error("[push] send failed", {
        subscriptionId: row.id,
        userId: row.user_id,
        role: row.role,
        statusCode,
        reason,
      });

      if (statusCode === 404 || statusCode === 410) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", row.endpoint);

        removed += 1;
      }
    }
  }

  return {
    ok: true,
    delivered,
    removed,
    failed,
    failures,
    message: "Push send finished.",
  };
}

export async function sendPushSafe(params: SendPushParams) {
  try {
    const result = await sendPushToTargets(params);
    console.log("[push] result", result);
    return result;
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error("[push] fatal error", {
      title: params.title,
      url: params.url,
      role: params.role,
      userIds: params.userIds,
      error: message,
    });

    return {
      ok: false,
      delivered: 0,
      removed: 0,
      failed: 0,
      failures: [{ subscriptionId: "fatal", reason: message || "Unknown push error" }],
      message: message || "Push send failed.",
    };
  }
}
