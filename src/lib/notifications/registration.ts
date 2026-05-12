"use client";

import { Capacitor } from "@capacitor/core";
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

function devLog(message: string, context?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[push-registration] ${message}`, context ?? {});
  }
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
  return null;
}

function deviceId() {
  try {
    const key = "moovu:push-device-id";
    const current = window.localStorage.getItem(key);
    if (current) return current;
    const next = crypto.randomUUID();
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
  const response = await fetch("/api/push/fcm/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({
      role: params.role,
      token: params.token,
      platform,
      appSource: appSource(params.role),
      appType: legacyAppType(params.role),
      deviceId: deviceId(),
      deviceLabel: platform === "web" ? navigator.userAgent : `${platform} native app`,
    }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    throw new Error(json?.error || "Failed to save notification token.");
  }
}

async function requestNativeToken(): Promise<string | null> {
  const permissions = await PushNotifications.checkPermissions();
  let receive = permissions.receive;

  if (receive !== "granted") {
    receive = (await PushNotifications.requestPermissions()).receive;
  }

  if (receive !== "granted") return null;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const cleanup = () => {
      for (const handle of handles) {
        void handle.remove();
      }
    };

    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Timed out while registering this device for push notifications."));
    }, 15000);

    PushNotifications.addListener("registration", (token) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      resolve(token.value);
    }).then((handle) => handles.push(handle)).catch(reject);

    PushNotifications.addListener("registrationError", (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error(error.error || "Native push registration failed."));
    }).then((handle) => handles.push(handle)).catch(reject);

    void PushNotifications.register();
  });
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

  const serviceWorkerRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
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
    const message = error instanceof Error ? error.message : "Failed to enable notifications.";
    const status = message.toLowerCase().includes("environment variables") ? "config-missing" : "failed";
    console.error("[push-registration] failed", { role, error: message });
    return { ok: false, status, message };
  }
}
