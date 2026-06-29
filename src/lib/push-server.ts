import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import type { PushRole } from "@/lib/push-auth";
import { sendApnsToDeviceToken } from "@/lib/apns-server";
import { getFirebaseAdminMessaging } from "@/lib/firebase/admin";
import { createNativeNotificationActionToken } from "@/lib/native-notification-actions";

const MOOVU_NOTIFICATION_SOUND = "moovu_premium_alert";
const MOOVU_TRIP_OFFER_SOUND = "moovu_trip_offer_buzz";
const MOOVU_ANDROID_CHANNEL_ID = "moovu_premium_v1";
const MOOVU_ANDROID_TRIP_OFFER_CHANNEL_ID = "moovu_trip_offer_buzz_v1";

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
          platform?: string | null;
          app_type?: string | null;
          device_id?: string | null;
          enabled?: boolean | null;
          updated_at?: string | null;
          last_used_at?: string | null;
          last_seen_at?: string | null;
          created_at?: string | null;
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
      notification_action_tokens: {
        Row: Record<string, unknown>;
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

function getRoleSiteOrigin(role: PushRole | null | undefined) {
  if (role === "driver") {
    const configured = process.env.NEXT_PUBLIC_DRIVER_SITE_URL || "https://driver.moovurides.co.za";
    return configured.startsWith("http") ? configured : `https://${configured}`;
  }

  if (role === "admin") {
    const configured = process.env.NEXT_PUBLIC_ADMIN_SITE_URL || "https://admin.moovurides.co.za";
    return configured.startsWith("http") ? configured : `https://${configured}`;
  }

  return getSiteOrigin();
}

function absoluteAppUrl(pathOrUrl: string | undefined) {
  try {
    return new URL(pathOrUrl || "/", getSiteOrigin()).href;
  } catch {
    return new URL("/", getSiteOrigin()).href;
  }
}

function absoluteRoleAppUrl(pathOrUrl: string | undefined, role: PushRole | null | undefined) {
  try {
    const url = new URL(pathOrUrl || "/", getRoleSiteOrigin(role));
    if (role === "driver" && url.hostname === "moovurides.co.za") {
      url.hostname = "driver.moovurides.co.za";
    }
    if (role === "admin" && url.hostname === "moovurides.co.za") {
      url.hostname = "admin.moovurides.co.za";
    }
    return url.href;
  } catch {
    return new URL("/", getRoleSiteOrigin(role)).href;
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

function isAndroidNativeToken(row: { platform?: string | null; app_type?: string | null }) {
  const platform = String(row.platform ?? "").toLowerCase();
  const appType = String(row.app_type ?? "").toLowerCase();
  return platform === "android" || appType.startsWith("android");
}

function isIosNativeToken(row: { platform?: string | null; app_type?: string | null }) {
  const platform = String(row.platform ?? "").toLowerCase();
  const appType = String(row.app_type ?? "").toLowerCase();
  return platform === "ios" || appType.startsWith("ios");
}

function isLegacyApnsDeviceToken(row: { token: string; platform?: string | null; app_type?: string | null }) {
  return isIosNativeToken(row) && /^[a-f0-9]{64}$/i.test(String(row.token).trim());
}

function isTripOfferData(data: PushData | undefined) {
  return String(data?.nativeActionType ?? "").toLowerCase() === "trip_offer";
}

function pushSoundNames(data: PushData | undefined) {
  const tripOffer = isTripOfferData(data);
  return {
    androidSound: tripOffer ? MOOVU_TRIP_OFFER_SOUND : MOOVU_NOTIFICATION_SOUND,
    androidChannelId: tripOffer ? MOOVU_ANDROID_TRIP_OFFER_CHANNEL_ID : MOOVU_ANDROID_CHANNEL_ID,
  };
}

function apnsOptions(title: string, body: string, data?: PushData) {
  return {
    headers: {
      "apns-priority": "10",
      "apns-push-type": "alert",
    },
    payload: {
      aps: {
        alert: {
          title,
          body,
        },
        sound: "default",
        badge: 1,
        ...(isTripOfferData(data) ? { "interruption-level": "time-sensitive" } : {}),
      },
    },
    fcmOptions: {
      analyticsLabel: "moovu_push",
    },
  } as const;
}

async function withNativeActionData(params: {
  supabase: AdminSupabaseClient;
  row: { user_id: string | null; role: PushRole | null };
  data: Record<string, string>;
}) {
  const actionType = params.data.nativeActionType;
  const tripId = params.data.tripId;

  if (
    !params.row.user_id ||
    !params.row.role ||
    !tripId ||
    (actionType !== "trip_offer" && actionType !== "chat_reply")
  ) {
    return params.data;
  }

  const token = await createNativeNotificationActionToken({
    supabase: params.supabase,
    userId: params.row.user_id,
    role: params.row.role,
    actionType,
    tripId,
    metadata: {
      title: params.data.title,
      body: params.data.body,
      url: params.data.url,
    },
  });

  if (!token) return params.data;

  return {
    ...params.data,
    nativeActionToken: token,
    nativeActionApiUrl: absoluteAppUrl("/api/notifications/native-action"),
    nativeClickUrl: absoluteRoleAppUrl(params.data.url || "/", params.row.role),
    nativeSound: params.data.nativeActionType === "trip_offer"
      ? MOOVU_TRIP_OFFER_SOUND
      : MOOVU_NOTIFICATION_SOUND,
    androidChannelId: params.data.nativeActionType === "trip_offer"
      ? MOOVU_ANDROID_TRIP_OFFER_CHANNEL_ID
      : MOOVU_ANDROID_CHANNEL_ID,
  };
}

function getSupabaseAdmin(): AdminSupabaseClient {
  return createClient<PushDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function tokenTargetKind(row: {
  platform?: string | null;
  app_type?: string | null;
  role?: PushRole | null;
  token: string;
}) {
  if (isLegacyApnsDeviceToken(row)) return "ios_apns_legacy";
  if (isIosNativeToken(row)) return "ios_fcm";
  if (isAndroidNativeToken(row)) return "android_fcm";
  const appType = String(row.app_type ?? "").toLowerCase();
  if (appType.startsWith("web")) return "web_fcm";
  return "unknown_fcm";
}

function sortTokenRows<T extends {
  updated_at?: string | null;
  last_seen_at?: string | null;
  last_used_at?: string | null;
  created_at?: string | null;
}>(rows: T[]) {
  const score = (value?: string | null) => {
    const ms = value ? new Date(value).getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
  };

  return [...rows].sort((a, b) => {
    return (
      score(b.updated_at) - score(a.updated_at) ||
      score(b.last_seen_at) - score(a.last_seen_at) ||
      score(b.last_used_at) - score(a.last_used_at) ||
      score(b.created_at) - score(a.created_at)
    );
  });
}

function dedupeActiveTokens(rows: PushDatabase["public"]["Tables"]["fcm_tokens"]["Row"][]) {
  const sorted = sortTokenRows(rows);
  const kept: PushDatabase["public"]["Tables"]["fcm_tokens"]["Row"][] = [];
  const seenDeviceSlots = new Set<string>();
  const seenTokens = new Set<string>();

  for (const row of sorted) {
    const token = String(row.token ?? "").trim();
    if (!token || seenTokens.has(token)) continue;

    const userId = String(row.user_id ?? "");
    const role = String(row.role ?? "");
    const appType = String(row.app_type ?? "");
    const deviceId = String(row.device_id ?? "").trim();
    const deviceSlot = deviceId ? `${userId}|${role}|${appType}|${deviceId}` : null;

    if (deviceSlot && seenDeviceSlots.has(deviceSlot)) {
      continue;
    }

    kept.push(row);
    seenTokens.add(token);
    if (deviceSlot) seenDeviceSlots.add(deviceSlot);
  }

  return kept;
}

function isMissingTableError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return (
    error?.code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("relation") && message.includes("does not exist")
  );
}

function isMissingFcmTokenColumnError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return error?.code === "42703" || (message.includes("column") && message.includes("fcm_tokens"));
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
      console.error("[notifications] app_notifications table missing. Run docs/notification-polish-migration.sql.", {
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
    .select("id,user_id,role,token,platform,app_type,device_id,enabled,updated_at,last_used_at,last_seen_at,created_at")
    .eq("is_active", true)
    .eq("enabled", true);

  if (params.userIds && params.userIds.length > 0) {
    query = query.in("user_id", params.userIds);
  }

  if (params.role) {
    query = query.eq("role", params.role);
  }

  let { data: tokens, error } = await query;
  if (error && isMissingFcmTokenColumnError(error)) {
    let fallbackQuery = supabase
      .from("fcm_tokens")
      .select("id,user_id,role,token,platform,app_type")
      .eq("is_active", true);

    if (params.userIds && params.userIds.length > 0) {
      fallbackQuery = fallbackQuery.in("user_id", params.userIds);
    }

    if (params.role) {
      fallbackQuery = fallbackQuery.eq("role", params.role);
    }

    const fallbackResult = await fallbackQuery;
    tokens = fallbackResult.data as typeof tokens;
    error = fallbackResult.error;
  }

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

  const targetRows = dedupeActiveTokens(tokens);
  const targetSummary = targetRows.reduce<Record<string, number>>((acc, row) => {
    const key = `${tokenTargetKind(row)}:${String(row.app_type ?? "unknown")}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  console.info("[push] target lookup", {
    role: params.role ?? null,
    requestedUsers: params.userIds?.length ?? 0,
    tokenCount: targetRows.length,
    targets: targetRows.map((row) => ({
      platform: row.platform,
      appType: row.app_type,
      role: row.role,
      kind: tokenTargetKind(row),
      deviceId: row.device_id ?? null,
    })),
    summary: targetSummary,
  });

  let delivered = 0;
  let removed = 0;
  let failed = 0;
  const failures: PushFailure[] = [];

  for (const row of targetRows) {
    const relativeUrl = params.url || "/";
    const clickUrl = absoluteAppUrl(relativeUrl);
    const androidNativeToken = isAndroidNativeToken(row);
    const iosNativeToken = isIosNativeToken(row);
    const { androidSound, androidChannelId } = pushSoundNames(params.data);
    const tokenKind = tokenTargetKind(row);

    try {
      const baseData = stringData(params.data, {
        title: params.title,
        body: params.body,
        url: relativeUrl,
        role: params.role || String(row.role || ""),
      });

      if (iosNativeToken && isLegacyApnsDeviceToken(row)) {
        const iosData = await withNativeActionData({
          supabase,
          row,
          data: baseData,
        });
        const apnsResult = await sendApnsToDeviceToken({
          token: String(row.token),
          appType: row.app_type,
          title: params.title,
          body: params.body,
          url: relativeUrl,
          data: iosData,
          sound: "default",
        });

        if (!apnsResult.ok) {
          failed += 1;
          failures.push({ subscriptionId: String(row.id), reason: apnsResult.reason });
          console.error("[apns] send failed", {
            tokenId: row.id,
            userId: row.user_id,
            role: row.role,
            appType: row.app_type,
            kind: tokenKind,
            status: apnsResult.status,
            reason: apnsResult.reason,
          });

          if (apnsResult.removeToken) {
            await supabase
              .from("fcm_tokens")
              .update({ is_active: false, updated_at: new Date().toISOString() })
              .eq("id", row.id);
            console.warn("[push] token deactivated", {
              tokenId: row.id,
              userId: row.user_id,
              role: row.role,
              appType: row.app_type,
              kind: tokenKind,
              reason: apnsResult.reason,
            });
            removed += 1;
          }
        } else {
          delivered += 1;
          console.info("[apns] send ok", {
            tokenId: row.id,
            userId: row.user_id,
            role: row.role,
            appType: row.app_type,
            kind: tokenKind,
          });
          await supabase
            .from("fcm_tokens")
            .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", row.id);
        }

        continue;
      }

      const data = androidNativeToken || iosNativeToken
        ? await withNativeActionData({
            supabase,
            row,
            data: baseData,
          })
        : baseData;
      const useNativeAndroidNotification = androidNativeToken && !!data.nativeActionToken;

      const responseId = await messaging.send({
        token: String(row.token),
        ...(useNativeAndroidNotification
          ? {}
          : {
              notification: {
                title: params.title,
                body: params.body,
              },
            }),
        data,
        android: {
          priority: "high",
          ...(useNativeAndroidNotification
            ? {}
            : {
                notification: {
                  title: params.title,
                  body: params.body,
                  icon: "ic_launcher",
                  sound: androidSound,
                  channelId: androidChannelId,
                  clickAction: "FCM_PLUGIN_ACTIVITY",
                },
              }),
        },
        apns: apnsOptions(params.title, params.body, params.data),
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
      console.info("[fcm] send ok", {
        tokenId: row.id,
        userId: row.user_id,
        role: row.role,
        platform: row.platform,
        appType: row.app_type,
        kind: tokenKind,
        responseId,
        usedTopLevelNotification: !useNativeAndroidNotification,
      });
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
        platform: row.platform,
        appType: row.app_type,
        kind: tokenKind,
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
        console.warn("[push] token deactivated", {
          tokenId: row.id,
          userId: row.user_id,
          role: row.role,
          appType: row.app_type,
          kind: tokenKind,
          code,
          reason,
        });
        removed += 1;
      }
    }
  }

  const userIds = Array.from(new Set(targetRows.map((row) => String(row.user_id)).filter(Boolean)));
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
  const { androidSound, androidChannelId } = pushSoundNames(payload.data);

  let delivered = 0;
  let removed = 0;
  let failed = 0;
  const failures: PushFailure[] = [];

  for (const token of uniqueTokens) {
    try {
      const responseId = await messaging.send({
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
            sound: androidSound,
            channelId: androidChannelId,
            clickAction: "FCM_PLUGIN_ACTIVITY",
          },
        },
        apns: apnsOptions(payload.title, payload.body, payload.data),
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
      console.info("[fcm] direct token send ok", {
        tokenSuffix: token.slice(-12),
        responseId,
      });
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
        console.warn("[push] direct token deactivated", {
          tokenSuffix: token.slice(-12),
          code,
          reason,
        });
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
