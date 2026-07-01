"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getToken as getFcmToken } from "firebase/messaging";
import { getFirebaseMessaging, hasFirebaseClientConfig } from "@/lib/firebase/client";

export type NotificationRole = "customer" | "driver" | "admin";

type RegisterForPushNotificationsParams = {
  userId: string;
  role: NotificationRole;
  supabase: SupabaseClient;
};

type RegisterForPushNotificationsResult =
  | {
      ok: true;
      token: string;
      platform: "android" | "ios" | "web";
      message: string;
    }
  | {
      ok: false;
      status: "missing-session" | "permission-denied" | "unsupported" | "config-missing" | "failed";
      message: string;
    };

type NativeListenerHandle = { remove: () => Promise<void> };

type FcmTokenPlugin = {
  getToken: () => Promise<{ token?: string | null }>;
  addListener: (
    eventName: "fcmTokenReady" | "fcmTokenError",
    listener: (event: { token?: string; message?: string }) => void,
  ) => Promise<NativeListenerHandle>;
};

const NativeFcmToken = registerPlugin<FcmTokenPlugin>("FcmToken");

function devLog(message: string, context?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[push-registration] ${message}`, context ?? {});
  }
}

function isIosApnsToken(token: string, platform = platformName()) {
  return platform === "ios" && /^[a-f0-9]{64}$/i.test(token.trim());
}

function isValidIosFcmToken(token: string) {
  const cleanToken = token.trim();
  return cleanToken.length > 100 && !isIosApnsToken(cleanToken, "ios");
}

const NATIVE_FCM_TOKEN_KEY = "moovu:native-fcm-token";

function getCachedNativeFcmToken() {
  try {
    const token = window.localStorage.getItem(`${NATIVE_FCM_TOKEN_KEY}:${platformName()}`)?.trim() ?? "";
    if (!token) return null;
    return platformName() === "ios" ? (isValidIosFcmToken(token) ? token : null) : token;
  } catch {
    return null;
  }
}

function cacheNativeFcmToken(token: string) {
  const cleanToken = token.trim();
  if (!cleanToken) return;
  if (platformName() === "ios" && !isValidIosFcmToken(cleanToken)) return;

  try {
    window.localStorage.setItem(`${NATIVE_FCM_TOKEN_KEY}:${platformName()}`, cleanToken);
  } catch {}
}

function platformName(): "android" | "ios" | "web" {
  const platform = Capacitor.getPlatform();
  return platform === "android" || platform === "ios" ? platform : "web";
}

function appSource(role: NotificationRole) {
  return `${platformName()}_${role}`;
}

function legacyAppType(role: NotificationRole) {
  const platform = platformName();
  if (platform === "web") return role === "driver" ? "web_driver" : role === "admin" ? "web_admin" : "web_customer";
  if (platform === "android" && role === "driver") return "android_driver";
  if (platform === "android" && role === "customer") return "android_customer";
  if (platform === "android" && role === "admin") return "web_admin";
  if (platform === "ios" && role === "driver") return "ios_driver";
  if (platform === "ios" && role === "customer") return "ios_customer";
  if (platform === "ios" && role === "admin") return "ios_admin";
  return null;
}

export function getPushDeviceId() {
  try {
    const key = "moovu:push-device-id";
    const current = window.localStorage.getItem(key);
    if (current) return current;
    const next = typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(key, next);
    return next;
  } catch {
    return null;
  }
}

async function saveToken(params: {
  accessToken: string;
  role: NotificationRole;
  token: string;
}) {
  const platform = platformName();
  const cleanToken = params.token.trim();
  if (platform === "ios" && !isValidIosFcmToken(cleanToken)) {
    console.warn("[push-registration] APNs token rejected, waiting for FCM token", {
      role: params.role,
      platform,
      length: cleanToken.length,
    });
    throw new Error("APNs token rejected, waiting for FCM token.");
  }
  const currentDeviceId = getPushDeviceId();
  const response = await fetch("/api/push/fcm/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({
      role: params.role,
      token: cleanToken,
      platform,
      appSource: appSource(params.role),
      appType: legacyAppType(params.role),
      deviceId: currentDeviceId,
      deviceLabel: platform === "web" ? navigator.userAgent : `${platform} native app`,
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION || null,
    }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    console.error("[push-registration] token API rejected", {
      role: params.role,
      platform,
      status: response.status,
    });
    throw new Error(json?.error || "Failed to save notification token.");
  }
  devLog("token registration API accepted", { role: params.role, platform });
}

export async function syncNativePushToken(params: {
  token: string;
  role: NotificationRole;
  supabase: SupabaseClient;
}) {
  const cleanToken = params.token.trim();
  const platform = platformName();
  if (!Capacitor.isNativePlatform() || !cleanToken) return false;
  if (platform === "ios" && !isValidIosFcmToken(cleanToken)) {
    console.warn("[push-registration] APNs token rejected, waiting for FCM token", {
      role: params.role,
      platform,
      length: cleanToken.length,
    });
    return false;
  }
  cacheNativeFcmToken(cleanToken);
  const { data: { session } } = await params.supabase.auth.getSession();
  if (!session?.access_token) return false;

  await saveToken({
    accessToken: session.access_token,
    role: params.role,
    token: cleanToken,
  });
  devLog("refreshed native token saved", {
    role: params.role,
    platform,
    tokenLength: cleanToken.length,
  });
  return true;
}

export async function bootstrapNativePushRegistration(params: {
  role: NotificationRole;
  supabase: SupabaseClient;
}) {
  if (!Capacitor.isNativePlatform()) return false;

  const permissions = await PushNotifications.checkPermissions().catch(() => null);
  devLog("native bootstrap permission status", {
    receive: permissions?.receive ?? "unknown",
    role: params.role,
    platform: platformName(),
  });

  if (!permissions || permissions.receive !== "granted") {
    return false;
  }

  devLog("native bootstrap registration started", {
    role: params.role,
    platform: platformName(),
  });
  await PushNotifications.register();
  return true;
}

async function ensureNativePermission() {
  const permissions = await PushNotifications.checkPermissions();
  devLog("native permission status", { receive: permissions.receive });
  let receive = permissions.receive;

  if (receive !== "granted") {
    devLog("requesting native notification permission");
    receive = (await PushNotifications.requestPermissions()).receive;
  }

  return receive === "granted";
}

async function requestIosFcmToken(): Promise<string | null> {
  if (!(await ensureNativePermission())) return null;

  const cachedToken = getCachedNativeFcmToken();
  if (cachedToken) {
    devLog("using cached native FCM token", {
      platform: platformName(),
      length: cachedToken.length,
    });
    return cachedToken;
  }

  let settled = false;
  let lastFirebaseError: string | null = null;
  let resolveToken!: (token: string) => void;
  let rejectToken!: (error: Error) => void;
  const handles: NativeListenerHandle[] = [];
  const tokenPromise = new Promise<string>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });

  const cleanup = () => {
    for (const handle of handles) {
      void handle.remove();
    }
  };

  const timeout = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectToken(new Error(lastFirebaseError || "Firebase did not return an iOS FCM token within 30 seconds."));
  }, 30000);

  try {
    const readyHandle = await NativeFcmToken.addListener("fcmTokenReady", (event) => {
      if (settled) return;
      const value = String(event.token ?? "").trim();
      devLog("native fcmTokenReady event received", {
        platform: "ios",
        length: value.length,
        apnsLike: isIosApnsToken(value, "ios"),
      });

      if (!isValidIosFcmToken(value)) {
        console.warn("[push-registration] APNs token rejected, waiting for FCM token", {
          platform: "ios",
          length: value.length,
        });
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      cacheNativeFcmToken(value);
      devLog("native FCM token received", { platform: "ios", length: value.length });
      resolveToken(value);
    });
    handles.push(readyHandle);

    const errorHandle = await NativeFcmToken.addListener("fcmTokenError", (event) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      rejectToken(new Error(event.message || "Firebase could not create an iOS FCM token."));
    });
    handles.push(errorHandle);

    devLog("native Firebase token bridge ready; starting APNs registration", {
      platform: "ios",
    });
    await PushNotifications.register();

    void (async () => {
      const deadline = Date.now() + 30000;

      while (!settled && Date.now() < deadline) {
        try {
          const result = await NativeFcmToken.getToken();
          const token = String(result.token ?? "").trim();
          if (isValidIosFcmToken(token)) {
            settled = true;
            window.clearTimeout(timeout);
            cleanup();
            cacheNativeFcmToken(token);
            devLog("native FCM token received by polling", { platform: "ios", length: token.length });
            resolveToken(token);
            return;
          }
        } catch (error: unknown) {
          lastFirebaseError = error instanceof Error ? error.message : "Firebase token lookup failed.";
        }

        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }

      if (!settled && lastFirebaseError) {
        settled = true;
        window.clearTimeout(timeout);
        cleanup();
        rejectToken(new Error(lastFirebaseError));
      }
    })();
  } catch (error) {
    if (!settled) {
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      const message = error instanceof Error ? error.message : "Native Firebase token bridge failed.";
      rejectToken(new Error(
        message.toLowerCase().includes("not implemented") || message.toLowerCase().includes("unavailable")
          ? "This iOS app build does not contain the MOOVU Firebase token bridge. Rebuild and reinstall the latest iOS app."
          : message,
      ));
    }
  }

  return tokenPromise;
}

async function requestCapacitorNativeToken(): Promise<string | null> {
  if (!(await ensureNativePermission())) return null;

  const cachedToken = getCachedNativeFcmToken();
  if (cachedToken) return cachedToken;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const handles: NativeListenerHandle[] = [];
    const cleanup = () => handles.forEach((handle) => void handle.remove());
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Timed out while registering this device for push notifications."));
    }, 30000);

    void (async () => {
      try {
        handles.push(await PushNotifications.addListener("registration", (token) => {
          if (settled) return;
          const value = String(token.value ?? "").trim();
          if (!value) return;
          settled = true;
          window.clearTimeout(timeout);
          cleanup();
          cacheNativeFcmToken(value);
          resolve(value);
        }));
        handles.push(await PushNotifications.addListener("registrationError", (error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          cleanup();
          reject(new Error(error.error || "Native push registration failed."));
        }));
        await PushNotifications.register();
      } catch (error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        cleanup();
        reject(error instanceof Error ? error : new Error("Native push registration failed."));
      }
    })();
  });
}

async function requestNativeToken() {
  return platformName() === "ios" ? requestIosFcmToken() : requestCapacitorNativeToken();
}

async function requestWebToken(): Promise<string | null> {
  if (!("Notification" in window)) {
    throw new Error("Notifications are not supported on this device.");
  }

  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported on this device.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  if (!hasFirebaseClientConfig()) {
    throw new Error("Firebase web notification environment variables are missing.");
  }

  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    throw new Error("Firebase messaging is not supported in this browser.");
  }

  const serviceWorkerRegistration = await navigator.serviceWorker.register(
    "/firebase-messaging-sw.js",
    { scope: "/firebase-cloud-messaging-push-scope" },
  );
  return getFcmToken(messaging, {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration,
  });
}

export async function registerForPushNotifications({
  userId,
  role,
  supabase,
}: RegisterForPushNotificationsParams): Promise<RegisterForPushNotificationsResult> {
  try {
    if (typeof window === "undefined") {
      return { ok: false, status: "unsupported", message: "Notifications can only be enabled in the browser or mobile app." };
    }

    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      return { ok: false, status: "missing-session", message: `Session error: ${error.message}` };
    }

    if (!session?.access_token || session.user.id !== userId) {
      return { ok: false, status: "missing-session", message: "Missing login session. Please sign in again." };
    }

    const platform = platformName();
    devLog("requesting token", { role, platform, appSource: appSource(role) });

    const token = Capacitor.isNativePlatform()
      ? await requestNativeToken()
      : await requestWebToken();

    if (!token) {
      return {
        ok: false,
        status: "permission-denied",
        message: "Notification permission was not granted. Allow MOOVU notifications in your device settings, then retry.",
      };
    }

    await saveToken({
      accessToken: session.access_token,
      role,
      token,
    });

    devLog("token saved", { role, platform });

    return {
      ok: true,
      token,
      platform,
      message: "Notifications enabled successfully.",
    };
  } catch (error: unknown) {
    const rawMessage = error instanceof Error ? error.message : "Failed to enable notifications.";
    const lowerMessage = rawMessage.toLowerCase();
    const message = lowerMessage.includes("aps-environment")
      ? "iOS push notifications are not enabled for this app build. Rebuild after enabling the Push Notifications entitlement and using a push-enabled provisioning profile."
      : rawMessage;
    const status = message.toLowerCase().includes("environment variables") ? "config-missing" : "failed";
    console.error("[push-registration] failed", { role, error: message });
    return { ok: false, status, message };
  }
}
