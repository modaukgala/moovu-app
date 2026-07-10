"use client";

import { useEffect, useRef } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import {
  resolveNotificationTarget,
  safeInternalNotificationUrl,
  type NotificationRouteRole,
  type NotificationRoutingPayload,
} from "@/lib/notifications/deepLinkRouting";
import { supabaseClient } from "@/lib/supabase/client";

const PENDING_NOTIFICATION_KEY = "moovu:pending-notification-route:v1";
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

type PendingNotification = {
  payload: NotificationRoutingPayload;
  createdAt: number;
};

type ListenerHandle = {
  remove: () => Promise<void>;
};

function currentAppRole(): NotificationRouteRole {
  const hostname = window.location.hostname.toLowerCase();
  const pathname = window.location.pathname;
  if (hostname.startsWith("driver.") || pathname.startsWith("/driver")) return "driver";
  if (hostname.startsWith("admin.") || pathname.startsWith("/admin")) return "admin";
  return "customer";
}

function notificationRole(payload: NotificationRoutingPayload) {
  const role = String(payload.role ?? "").toLowerCase();
  return role === "customer" || role === "driver" || role === "admin"
    ? role
    : currentAppRole();
}

function readPendingNotification(): PendingNotification | null {
  try {
    const raw = window.localStorage.getItem(PENDING_NOTIFICATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingNotification;
    if (!parsed?.payload || !Number.isFinite(parsed.createdAt)) return null;
    if (Date.now() - parsed.createdAt > MAX_PENDING_AGE_MS) {
      window.localStorage.removeItem(PENDING_NOTIFICATION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function savePendingNotification(payload: NotificationRoutingPayload) {
  try {
    window.localStorage.setItem(
      PENDING_NOTIFICATION_KEY,
      JSON.stringify({ payload, createdAt: Date.now() } satisfies PendingNotification),
    );
  } catch {}
}

function clearPendingNotification() {
  try {
    window.localStorage.removeItem(PENDING_NOTIFICATION_KEY);
  } catch {}
}

function loginRoute(role: NotificationRouteRole, target: string) {
  const next = encodeURIComponent(target);
  if (role === "driver") return `/driver/login?next=${next}`;
  if (role === "admin") return "/admin/login";
  return `/customer/auth?next=${next}`;
}

function sameLocation(target: string) {
  return target === `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function notificationActionKind(actionId: unknown) {
  const normalized = String(actionId ?? "").trim().toUpperCase();
  if (normalized === "ACCEPT_TRIP" || normalized.endsWith("ACTION_ACCEPT_TRIP")) return "accept";
  if (normalized === "DECLINE_TRIP" || normalized.endsWith("ACTION_DECLINE_TRIP")) return "decline";
  if (normalized === "REPLY_CHAT" || normalized.endsWith("ACTION_REPLY_CHAT")) return "reply";
  return null;
}

async function performSignedNativeAction(params: {
  payload: NotificationRoutingPayload;
  action: "accept" | "decline" | "reply";
  replyText?: string;
}) {
  const token = String(params.payload.nativeActionToken ?? "").trim();
  const apiUrl = safeInternalNotificationUrl(params.payload.nativeActionApiUrl)
    || String(params.payload.nativeActionApiUrl ?? "").trim();

  if (!token || !apiUrl) return false;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      action: params.action,
      ...(params.action === "reply" ? { replyText: params.replyText ?? "" } : {}),
    }),
  }).catch(() => null);
  const json = await response?.json().catch(() => null);

  if (!response?.ok || !json?.ok) {
    console.warn("[notification-routing] native action failed", {
      action: params.action,
      status: response?.status ?? null,
      error: json?.error ?? "Notification action failed.",
    });
    return false;
  }

  console.info("[notification-routing] native action completed", {
    action: params.action,
    type: params.payload.notificationType || params.payload.type || params.payload.nativeActionType || null,
  });
  return true;
}

async function resolveDriverOfferTarget(
  target: string,
  payload: NotificationRoutingPayload,
  accessToken: string,
) {
  if (!target.startsWith("/driver?offerTripId=")) return target;

  const expectedTripId = String(payload.tripId || payload.trip_id || "").trim();
  const response = await fetch("/api/driver/offers/current", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  const json = await response?.json().catch(() => null);

  if (!response?.ok || !json?.ok) return target;
  if (!json.offer || (expectedTripId && String(json.offer.id) !== expectedTripId)) {
    return "/driver?offerExpired=1";
  }
  return target;
}

export default function NotificationDeepLinkRouter() {
  const processingRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let active = true;
    const handles: ListenerHandle[] = [];

    async function processPendingNotification() {
      if (!active || processingRef.current) return;
      const pending = readPendingNotification();
      if (!pending) return;

      processingRef.current = true;
      try {
        const role = notificationRole(pending.payload);
        let target = resolveNotificationTarget(pending.payload, role);
        const {
          data: { session },
        } = await supabaseClient.auth.getSession();

        if (!session?.access_token) {
          const login = loginRoute(role, target);
          if (!sameLocation(login) && !window.location.pathname.includes("/login") && !window.location.pathname.includes("/auth")) {
            window.location.assign(login);
          }
          return;
        }

        if (role === "driver") {
          target = await resolveDriverOfferTarget(target, pending.payload, session.access_token);
        }

        clearPendingNotification();
        console.info("[notification-routing] opening target", {
          role,
          target,
          type: pending.payload.notificationType || pending.payload.type || pending.payload.nativeActionType || null,
        });
        if (!sameLocation(target)) {
          window.location.assign(target);
        }
      } finally {
        processingRef.current = false;
      }
    }

    function capture(payload: NotificationRoutingPayload) {
      savePendingNotification(payload);
      void processPendingNotification();
    }

    async function installListeners() {
      const actionHandle = await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
          const payload = (action.notification.data ?? {}) as NotificationRoutingPayload;
          const actionKind = notificationActionKind(action.actionId);
          if (actionKind) {
            void performSignedNativeAction({
              payload,
              action: actionKind,
              replyText: typeof action.inputValue === "string" ? action.inputValue : "",
            }).finally(() => {
              if (actionKind !== "decline") capture(payload);
            });
            return;
          }

          capture(payload);
        },
      );
      if (!active) {
        await actionHandle.remove();
        return;
      }
      handles.push(actionHandle);

      const appUrlHandle = await App.addListener("appUrlOpen", ({ url }) => {
        const internalUrl = safeInternalNotificationUrl(url);
        if (internalUrl) capture({ url: internalUrl, role: currentAppRole() });
      });
      if (!active) {
        await appUrlHandle.remove();
        return;
      }
      handles.push(appUrlHandle);
    }

    const { data: authListener } = supabaseClient.auth.onAuthStateChange(() => {
      window.setTimeout(() => void processPendingNotification(), 0);
    });

    void installListeners()
      .then(() => processPendingNotification())
      .catch((error: unknown) => {
        console.error("[notification-routing] listener setup failed", {
          error: error instanceof Error ? error.message : "Unknown native routing error",
        });
      });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      for (const handle of handles) void handle.remove();
    };
  }, []);

  return null;
}
