"use client";

import { useCallback, useEffect, useState } from "react";
import { PushNotifications } from "@capacitor/push-notifications";
import { Capacitor } from "@capacitor/core";
import { getPushDeviceId, registerForPushNotifications, type NotificationRole } from "@/lib/notifications/registration";
import { supabaseClient } from "@/lib/supabase/client";

type Props = {
  role: NotificationRole;
  onEnabled?: () => void;
  variant?: "floating" | "inline";
};

type NotificationStatusResponse = {
  ok?: boolean;
  activeTokenCount?: number;
  activeDeviceTokenCount?: number;
};

function savedKey(userId: string, role: NotificationRole) {
  return `moovu:fcm-enabled:${userId}:${role}:${Capacitor.getPlatform()}:${getPushDeviceId() ?? "unknown-device"}`;
}

function getSaved(userId: string, role: NotificationRole) {
  try {
    return window.localStorage.getItem(savedKey(userId, role)) === "1";
  } catch {
    return false;
  }
}

function setSaved(userId: string, role: NotificationRole) {
  try {
    window.localStorage.setItem(savedKey(userId, role), "1");
  } catch {}
}

export default function EnableNotificationsButton({ role, onEnabled, variant = "floating" }: Props) {
  const [busy, setBusy] = useState(false);
  const [saved, setSavedState] = useState(false);
  const [message, setMessage] = useState("");
  const [canRequest, setCanRequest] = useState(true);
  const [statusLabel, setStatusLabel] = useState("Enable Notifications");

  const markSaved = useCallback((userId: string, nextMessage = "Notifications enabled successfully.") => {
    setSaved(userId, role);
    setSavedState(true);
    setStatusLabel("Notifications Enabled");
    setMessage(nextMessage);
    onEnabled?.();
  }, [onEnabled, role]);

  useEffect(() => {
    let cancelled = false;

    async function checkExistingState() {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (cancelled) return;

      if (session?.user?.id) {
        if (getSaved(session.user.id, role)) {
          setSavedState(true);
          setStatusLabel("Notifications Enabled");
          setMessage("Token saved on this device.");
          return;
        }

        const deviceId = getPushDeviceId();
        const statusUrl = new URL("/api/notifications/status", window.location.origin);
        statusUrl.searchParams.set("role", role);
        if (deviceId) statusUrl.searchParams.set("deviceId", deviceId);

        const statusResponse = await fetch(statusUrl.toString(), {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }).catch(() => null);

        const statusJson = (await statusResponse?.json().catch(() => null)) as NotificationStatusResponse | null;
        if (!cancelled && statusResponse?.ok && statusJson?.ok && Number(statusJson.activeDeviceTokenCount ?? 0) > 0) {
          markSaved(session.user.id, "Notifications are already enabled on this device.");
          return;
        }
      }

      if (Capacitor.isNativePlatform()) {
        const permissions = await PushNotifications.checkPermissions().catch(() => null);
        if (cancelled || !permissions) return;
        if (permissions.receive === "denied") {
          setCanRequest(false);
          setStatusLabel("Permission Denied");
          setMessage("Notifications are blocked. Allow MOOVU notifications in app settings, then retry.");
        }
        return;
      }

      if (typeof window === "undefined") return;
      if (!("Notification" in window) || !("serviceWorker" in navigator)) {
        setCanRequest(false);
        setStatusLabel("Unsupported Platform");
        setMessage("Push notifications are not supported on this device.");
        return;
      }

      if (Notification.permission === "denied") {
        setCanRequest(false);
        setStatusLabel("Permission Denied");
        setMessage("Notifications are blocked. Allow MOOVU notifications in your browser settings, then retry.");
      }
    }

    void checkExistingState();

    return () => {
      cancelled = true;
    };
  }, [markSaved, role]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handles: Array<{ remove: () => Promise<void> }> = [];

    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const url = action.notification.data?.url;
      if (typeof url === "string" && url.length > 0) {
        window.location.assign(url);
      }
    }).then((handle) => handles.push(handle)).catch(() => undefined);

    return () => {
      for (const handle of handles) {
        void handle.remove();
      }
    };
  }, []);

  async function handleClick() {
    setBusy(true);
    setMessage("");
    setStatusLabel("Enabling...");

    try {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!session?.user?.id) {
        setStatusLabel("Token Missing");
        setMessage("Missing login session. Please sign in again.");
        return;
      }

      const result = await registerForPushNotifications({
        userId: session.user.id,
        role,
        supabase: supabaseClient,
      });

      if (!result.ok) {
        if (result.status === "permission-denied" || result.status === "unsupported") {
          setCanRequest(false);
        }
        setStatusLabel(
          result.status === "permission-denied"
            ? "Permission Denied"
            : result.status === "unsupported"
              ? "Unsupported Platform"
              : result.status === "missing-session"
                ? "Token Missing"
                : "Enable Notifications",
        );
        setMessage(result.message);
        return;
      }

      markSaved(session.user.id, "Notifications enabled on this device.");

      const testResponse = await fetch("/api/push/test-self", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ role }),
      });

      const testJson = await testResponse.json().catch(() => null);
      if (!testResponse.ok || !testJson?.ok) {
        console.warn("[push-registration] self-test did not deliver", {
          role,
          error: testJson?.error || "Token saved, but the test notification did not deliver.",
        });
        return;
      }
    } finally {
      setBusy(false);
      setStatusLabel((current) => current === "Enabling..." ? "Enable Notifications" : current);
    }
  }

  if (saved && variant === "floating") return null;

  if (!canRequest && variant === "floating") {
    return message ? (
      <div className="max-w-[280px] rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow">
        {message}
      </div>
    ) : null;
  }

  if (saved) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
        Notifications Enabled
      </div>
    );
  }

  return (
    <div className={variant === "inline" ? "flex flex-col gap-2" : "flex flex-col items-end gap-2"}>
      {canRequest && (
        <button
          type="button"
          onClick={handleClick}
          disabled={busy}
          className={
            variant === "inline"
              ? "min-h-11 rounded-2xl bg-[var(--moovu-primary)] px-4 py-3 text-sm font-bold text-white shadow-sm disabled:opacity-60"
              : "rounded-full bg-[var(--moovu-primary)] px-4 py-3 text-white shadow-lg disabled:opacity-60"
          }
        >
          {busy ? "Enabling..." : statusLabel}
        </button>
      )}

      {message ? (
        <div className={variant === "inline" ? "rounded-xl bg-white/80 px-3 py-2 text-xs text-slate-700" : "max-w-[280px] rounded-xl bg-white px-3 py-2 text-xs text-slate-700 shadow"}>
          {message}
        </div>
      ) : null}
    </div>
  );
}
