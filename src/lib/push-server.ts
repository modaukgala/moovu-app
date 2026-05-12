import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import type { PushRole } from "@/lib/push-auth";
import { getFirebaseAdminMessaging } from "@/lib/firebase/admin";

type SendPushParams = {
  userIds?: string[];
  role?: PushRole;
  title: string;
  body: string;
  url?: string;
  data?: PushData;
};

type PushFailure = {
  subscriptionId: string;
  reason: string;
};

type PushData = Record<string, string | number | boolean | null | undefined>;

type SendPushPayload = {
  title: string;
  body: string;
  url?: string;
  data?: PushData;
};

type PushDatabase = {
  public: {
    Tables: {
      fcm_tokens: {
        Row: {
          id: string;
          user_id: string | null;
          role: PushRole | null;
          token: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      app_notifications: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string | null;
          role: PushRole | null;
          endpoint: string;
          subscription: unknown;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

type AdminSupabaseClient = ReturnType<typeof createClient<PushDatabase>>;

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

function getFirebaseErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const record = error as Record<string, unknown>;
  return typeof record.code === "string" ? record.code : "";
}

function getSiteOrigin() {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://moovurides.co.za";

  return configured.startsWith("http") ? configured : `https://${configured}`;
}

function absoluteAppUrl(pathOrUrl: string | undefined) {
  try {
    return new URL(pathOrUrl || "/", getSiteOrigin()).href;
  } catch {
    return new URL("/", getSiteOrigin()).href;
  }
}

function stringData(data: PushData | undefined, fallback: Record<string, string>) {
  const result: Record<string, string> = { ...fallback };

  for (const [key, value] of Object.entries(data ?? {})) {
    if (value === undefined || value === null) continue;
    result[key] = String(value);
  }

  return result;
}

function getSupabaseAdmin(): AdminSupabaseClient {
  return createClient<PushDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function isMissingTableError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return (
    error?.code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("relation") && message.includes("does not exist")
  );
}

async function recordNotificationHistory(params: {
  supabase: AdminSupabaseClient;
  userIds: string[];
  role?: PushRole;
  title: string;
  body: string;
  url?: string;
  data?: PushData;
  deliveryStatus: "queued" | "sent" | "failed" | "no_tokens";
  errorMessage?: string | null;
}) {
  const uniqueUserIds = Array.from(new Set(params.userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) return;

  const now = new Date().toISOString();
  const rows = uniqueUserIds.map((userId) => ({
    user_id: userId,
    role: params.role ?? null,
    title: params.title,
    body: params.body,
    url: params.url ?? "/",
    data: params.data ?? {},
    delivery_status: params.deliveryStatus,
    error_message: params.errorMessage ?? null,
    created_at: now,
    updated_at: now,
  }));

  const { error } = await params.supabase.from("app_notifications").insert(rows);
  if (error) {
    const reason = error.message;
    if (isMissingTableError(error)) {
      console.error("[notifications] app_notifications table missing. Run docs/fcm-notifications-migration.sql.", {
        reason,
      });
      return;
    }

    console.error("[notifications] failed to record notification history", { reason });
  }
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

async function sendFcmToTargets(params: SendPushParams) {
  const messaging = getFirebaseAdminMessaging();
  if (!messaging) {
    console.error("[fcm] Firebase Admin is not configured. Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY.");
    return { delivered: 0, removed: 0, failed: 0, failures: [] as PushFailure[] };
  }

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("fcm_tokens")
    .select("id,user_id,role,token")
    .eq("is_active", true);

  if (params.userIds && params.userIds.length > 0) {
    query = query.in("user_id", params.userIds);
  }

  if (params.role) {
    query = query.eq("role", params.role);
  }

  const { data: tokens, error } = await query;
  if (error) {
    console.error("[fcm] token lookup failed", { error: error.message });
    return { delivered: 0, removed: 0, failed: 0, failures: [] as PushFailure[] };
  }

  if (!tokens || tokens.length === 0) {
    if (params.userIds && params.userIds.length > 0) {
      await recordNotificationHistory({
        supabase,
        userIds: params.userIds,
        role: params.role,
        title: params.title,
        body: params.body,
        url: params.url,
        data: params.data,
        deliveryStatus: "no_tokens",
        errorMessage: "No active FCM tokens found for target.",
      });
    }

    return { delivered: 0, removed: 0, failed: 0, failures: [] as PushFailure[] };
  }

  let delivered = 0;
  let removed = 0;
  let failed = 0;
  const failures: PushFailure[] = [];

  for (const row of tokens) {
    const relativeUrl = params.url || "/";
    const clickUrl = absoluteAppUrl(relativeUrl);

    try {
      const data = stringData(params.data, {
        title: params.title,
        body: params.body,
        url: relativeUrl,
        role: params.role || String(row.role || ""),
      });

      await messaging.send({
        token: String(row.token),
        notification: {
          title: params.title,
          body: params.body,
        },
        data,
        android: {
          priority: "high",
          notification: {
            title: params.title,
            body: params.body,
            icon: "ic_launcher",
            sound: "default",
            clickAction: "FCM_PLUGIN_ACTIVITY",
          },
        },
        webpush: {
          notification: {
            title: params.title,
            body: params.body,
            icon: absoluteAppUrl("/icon-192.png"),
            badge: absoluteAppUrl("/icon-192.png"),
            data: {
              url: relativeUrl,
            },
          },
          fcmOptions: {
            link: clickUrl,
          },
        },
      });
      delivered += 1;
      await supabase
        .from("fcm_tokens")
        .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", row.id);
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      const code = getFirebaseErrorCode(error);
      failed += 1;
      failures.push({ subscriptionId: String(row.id), reason });
      console.error("[fcm] send failed", {
        tokenId: row.id,
        userId: row.user_id,
        role: row.role,
        code,
        reason,
      });

      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        reason.includes("registration-token-not-registered") ||
        reason.includes("invalid-registration-token")
      ) {
        await supabase
          .from("fcm_tokens")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        removed += 1;
      }
    }
  }

  const userIds = Array.from(new Set(tokens.map((row) => String(row.user_id)).filter(Boolean)));
  await recordNotificationHistory({
    supabase,
    userIds,
    role: params.role,
    title: params.title,
    body: params.body,
    url: params.url,
    data: params.data,
    deliveryStatus: delivered > 0 ? "sent" : "failed",
    errorMessage: failures[0]?.reason ?? null,
  });

  return { delivered, removed, failed, failures };
}

export async function sendPushToTokens(tokens: string[], payload: SendPushPayload) {
  const messaging = getFirebaseAdminMessaging();
  if (!messaging) {
    return {
      ok: false,
      delivered: 0,
      removed: 0,
      failed: tokens.length,
      failures: [{ subscriptionId: "firebase-admin", reason: "Firebase Admin is not configured." }],
      message: "Firebase Admin is not configured.",
    };
  }

  const uniqueTokens = Array.from(new Set(tokens.map((token) => token.trim()).filter(Boolean)));
  if (uniqueTokens.length === 0) {
    return { ok: true, delivered: 0, removed: 0, failed: 0, failures: [], message: "No push tokens supplied." };
  }

  const supabase = getSupabaseAdmin();
  const url = payload.url || "/";
  const data = stringData(payload.data, {
    title: payload.title,
    body: payload.body,
    url,
  });

  let delivered = 0;
  let removed = 0;
  let failed = 0;
  const failures: PushFailure[] = [];

  for (const token of uniqueTokens) {
    try {
      await messaging.send({
        token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data,
        android: {
          priority: "high",
          notification: {
            title: payload.title,
            body: payload.body,
            icon: "ic_launcher",
            sound: "default",
            clickAction: "FCM_PLUGIN_ACTIVITY",
          },
        },
        webpush: {
          notification: {
            title: payload.title,
            body: payload.body,
            icon: absoluteAppUrl("/icon-192.png"),
            badge: absoluteAppUrl("/icon-192.png"),
            data: { url },
          },
          fcmOptions: {
            link: absoluteAppUrl(url),
          },
        },
      });
      delivered += 1;
      await supabase
        .from("fcm_tokens")
        .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("token", token);
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      const code = getFirebaseErrorCode(error);
      failed += 1;
      failures.push({ subscriptionId: token.slice(-12), reason });

      console.error("[fcm] direct token send failed", { code, reason });

      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        reason.includes("registration-token-not-registered") ||
        reason.includes("invalid-registration-token")
      ) {
        await supabase
          .from("fcm_tokens")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("token", token);
        removed += 1;
      }
    }
  }

  return {
    ok: failed === 0 || delivered > 0,
    delivered,
    removed,
    failed,
    failures,
    message: "FCM direct token send finished.",
  };
}

export async function sendPushToRole(role: PushRole, payload: SendPushPayload) {
  return sendPushSafe({
    role,
    title: payload.title,
    body: payload.body,
    url: payload.url,
    data: payload.data,
  });
}

export async function sendPushNotification({
  userId,
  role,
  title,
  body,
  data,
}: {
  userId: string;
  role: PushRole;
  title: string;
  body: string;
  data?: PushData;
}) {
  return sendPushSafe({
    userIds: [userId],
    role,
    title,
    body,
    url: typeof data?.url === "string" ? data.url : undefined,
    data,
  });
}

export async function sendPushToTargets(params: SendPushParams) {
  const supabase = getSupabaseAdmin();
  const fcmResult = await sendFcmToTargets(params);

  try {
    ensureVapidConfigured();
  } catch (error: unknown) {
    if (fcmResult.delivered > 0 || fcmResult.failed > 0) {
      return {
        ok: true,
        delivered: fcmResult.delivered,
        removed: fcmResult.removed,
        failed: fcmResult.failed,
        failures: fcmResult.failures,
        message: "FCM push send finished. Web push skipped because VAPID is not configured.",
      };
    }
    throw error;
  }

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
    if (fcmResult.delivered > 0 || fcmResult.failed > 0 || fcmResult.removed > 0) {
      return {
        ok: true,
        delivered: fcmResult.delivered,
        removed: fcmResult.removed,
        failed: fcmResult.failed,
        failures: fcmResult.failures,
        message: "FCM push send finished. No matching legacy Web Push subscriptions were found.",
      };
    }

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
    data: params.data ?? {},
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
    delivered: delivered + fcmResult.delivered,
    removed: removed + fcmResult.removed,
    failed: failed + fcmResult.failed,
    failures: [...failures, ...fcmResult.failures],
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
