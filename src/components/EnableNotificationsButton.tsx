"use client";

import { useCallback, useEffect, useState } from "react";
import { PushNotifications } from "@capacitor/push-notifications";
import { Capacitor } from "@capacitor/core";
import { getPushDeviceId, registerForPushNotifications, type NotificationRole } from "@/lib/notifications/registration";
import { supabaseClient } from "@/lib/supabase/client";

type Props = {
  role: NotificationRole;
  onEnabled?: () => void;
  variant?: "floating" | "inline" | "chip";
};

type Availability = "ready" | "denied" | "unsupported" | "ios-unavailable";

type NotificationStatusResponse = {
  ok?: boolean;
  activeTokenCount?: number;
  activeDeviceTokenCount?: number;
};

function savedKey(userId: string, role: NotificationRole) {
  return `moovu:fcm-enabled:${userId}:${role}:${Capacitor.getPlatform()}:${getPushDeviceId() ?? "unknown-device"}`;
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
  const [availability, setAvailability] = useState<Availability>("ready");

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
      if (Capacitor.isNativePlatform()) {
        const permissions = await PushNotifications.checkPermissions().catch(() => null);
        if (cancelled) return;
        if (permissions?.receive === "denied") {
          setAvailability("denied");
          setCanRequest(false);
          setStatusLabel("Notifications blocked");
          setMessage("Notifications are blocked. Enable them in your device settings.");
          return;
        }
      } else {
        if (typeof window === "undefined") return;
        if (!("Notification" in window) || !("serviceWorker" in navigator)) {
          setAvailability("unsupported");
          setCanRequest(false);
          setStatusLabel("Notifications not supported");
          setMessage("Push notifications are not supported on this device.");
          return;
        }

        if (Notification.permission === "denied") {
          setAvailability("denied");
          setCanRequest(false);
          setStatusLabel("Notifications blocked");
          setMessage("Notifications are blocked. Enable them in your browser settings.");
          return;
        }
      }

      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (cancelled) return;

      if (session?.user?.id) {
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
    }

    void checkExistingState();

    return () => {
      cancelled = true;
    };
  }, [markSaved, role]);

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
        const isIosEntitlementError = Capacitor.getPlatform() === "ios" && (
          result.message.toLowerCase().includes("aps-environment") ||
          result.message.toLowerCase().includes("not enabled for this app build") ||
          result.message.toLowerCase().includes("push notifications are not enabled")
        );

        if (isIosEntitlementError) {
          setAvailability("ios-unavailable");
          setCanRequest(false);
        } else if (result.status === "permission-denied") {
          setAvailability("denied");
          setCanRequest(false);
        } else if (result.status === "unsupported") {
          setAvailability("unsupported");
          setCanRequest(false);
        }
        setStatusLabel(
          isIosEntitlementError
            ? "Notifications unavailable in this iOS build"
            : result.status === "permission-denied"
            ? "Notifications blocked"
            : result.status === "unsupported"
              ? "Notifications not supported"
              : result.status === "missing-session"
                ? "Token Missing"
                : "Enable notifications",
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
      <div className={variant === "chip"
        ? "inline-flex min-h-11 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"
        : "rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"}
      >
        {variant === "chip" ? <span aria-hidden="true">&#128276;</span> : null}
        {variant === "chip" ? "Notifications enabled" : "Notifications Enabled"}
      </div>
    );
  }

  const isChip = variant === "chip";
  const chipLabel = busy
    ? "Enabling..."
    : availability === "denied"
      ? "Notifications blocked"
      : availability === "unsupported"
        ? "Notifications not supported"
        : availability === "ios-unavailable"
          ? "Notifications unavailable in this iOS build"
          : "Enable notifications";

  return (
    <div className={variant === "inline" ? "flex flex-col gap-2" : "flex flex-col items-end gap-2"}>
      {(canRequest || isChip) && (
        <button
          type="button"
          onClick={handleClick}
          disabled={busy || !canRequest}
          aria-label={chipLabel}
          className={
            isChip
              ? `inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full border px-3 py-2 text-xs font-bold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed ${
                  canRequest
                    ? "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100"
                    : "border-slate-200 bg-slate-100 text-slate-600"
                }`
              : variant === "inline"
              ? "min-h-11 rounded-2xl bg-[var(--moovu-primary)] px-4 py-3 text-sm font-bold text-white shadow-sm disabled:opacity-60"
              : "rounded-full bg-[var(--moovu-primary)] px-4 py-3 text-white shadow-lg disabled:opacity-60"
          }
        >
          {isChip ? <span aria-hidden="true">&#128276;</span> : null}
          {isChip ? chipLabel : busy ? "Enabling..." : statusLabel}
        </button>
      )}

      {message ? (
        <div className={variant === "inline"
          ? "rounded-xl bg-white/80 px-3 py-2 text-xs text-slate-700"
          : isChip
            ? "max-w-[260px] text-right text-[11px] font-medium leading-4 text-slate-600"
            : "max-w-[280px] rounded-xl bg-white px-3 py-2 text-xs text-slate-700 shadow"}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
