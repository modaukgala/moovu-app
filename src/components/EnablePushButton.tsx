"use client";

import { useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type Role = "admin" | "driver" | "customer";

type Props = {
  role: Role;
  onEnabled?: () => void;
  variant?: "floating" | "inline";
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function EnablePushButton({ role, onEnabled, variant = "floating" }: Props) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState("");
  const [canRequest, setCanRequest] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    async function checkExistingSubscription() {
      if (!("Notification" in window)) {
        setCanRequest(false);
        setMsg("Push notifications are not supported on this device.");
        return;
      }

      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setCanRequest(false);
        setMsg("Push notifications are unavailable in this browser. On iPhone, install MOOVU to the Home Screen first.");
        return;
      }

      if (Notification.permission === "denied") {
        setCanRequest(false);
        setMsg("Notifications are blocked. Allow MOOVU notifications in your browser or app settings, then retry.");
        return;
      }

      if (Notification.permission !== "granted") return;

      try {
        const {
          data: { session },
        } = await supabaseClient.auth.getSession();

        const accessToken = session?.access_token;
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();

        if (cancelled) return;

        if (!sub) {
          setMsg("Notifications are allowed. Tap to save this device for MOOVU updates.");
          return;
        }

        if (!accessToken) {
          setMsg("Notifications are allowed. Please log in again to save this device.");
          return;
        }

        const subscribeRes = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            role,
            subscription: sub.toJSON(),
          }),
        });

        const subscribeJson = await subscribeRes.json().catch(() => null);
        if (cancelled) return;

        if (subscribeRes.ok && subscribeJson?.ok) {
          setSaved(true);
          setMsg("Push enabled");
          onEnabled?.();
          return;
        }

        setMsg(subscribeJson?.error || "Notifications are allowed. Tap to retry saving this device.");
      } catch {
        if (!cancelled) {
          setMsg("Notifications are allowed. Tap to retry saving this device.");
        }
      }
    }

    void checkExistingSubscription();

    return () => {
      cancelled = true;
    };
  }, [onEnabled, role]);

  async function handleClick() {
    try {
      setBusy(true);
      setMsg("");

      const {
        data: { session },
        error: sessionError,
      } = await supabaseClient.auth.getSession();

      if (sessionError) {
        setMsg(`Session error: ${sessionError.message}`);
        return;
      }

      const accessToken = session?.access_token;
      if (!accessToken) {
        setMsg("Missing access token. Please log in again.");
        return;
      }

      if (!("Notification" in window)) {
        setCanRequest(false);
        setMsg("Push notifications are not supported on this device.");
        return;
      }

      if (!("serviceWorker" in navigator)) {
        setCanRequest(false);
        setMsg("This device does not support push notifications.");
        return;
      }

      if (!("PushManager" in window)) {
        setCanRequest(false);
        setMsg("Push notifications are unavailable in this browser. On iPhone, install MOOVU to the Home Screen first.");
        return;
      }

      const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapid) {
        setMsg("Push notifications are not configured.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setCanRequest(false);
        setMsg("Notifications are blocked. Allow MOOVU notifications in your browser or app settings, then retry.");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid),
        });
      }

      const subscribeRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          role,
          subscription: sub.toJSON(),
        }),
      });

      const subscribeJson = await subscribeRes.json().catch(() => null);

      if (!subscribeRes.ok || !subscribeJson?.ok) {
        setMsg(subscribeJson?.error || "Failed to save push subscription.");
        return;
      }

      const testRes = await fetch("/api/push/test-self", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ role }),
      });

      const testJson = await testRes.json().catch(() => null);

      if (!testRes.ok || !testJson?.ok) {
        setMsg(testJson?.error || "Subscription saved, but test notification failed.");
        return;
      }

      setMsg("Notifications enabled successfully.");
      setSaved(true);
      onEnabled?.();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Failed to enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  if ((saved || !canRequest) && variant === "floating") return null;

  if (saved) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
        Push enabled
      </div>
    );
  }

  return (
    <div className={variant === "inline" ? "flex flex-col gap-2" : "flex flex-col items-end gap-2"}>
      {canRequest && (
        <button
          onClick={handleClick}
          disabled={busy}
          className={
            variant === "inline"
              ? "min-h-11 rounded-2xl bg-[var(--moovu-primary)] px-4 py-3 text-sm font-bold text-white shadow-sm disabled:opacity-60"
              : "rounded-full bg-[var(--moovu-primary)] px-4 py-3 text-white shadow-lg disabled:opacity-60"
          }
        >
          {busy ? "Enabling..." : "Enable notifications"}
        </button>
      )}

      {msg ? (
        <div className={variant === "inline" ? "rounded-xl bg-white/80 px-3 py-2 text-xs text-slate-700" : "max-w-[280px] rounded-xl bg-white px-3 py-2 text-xs text-slate-700 shadow"}>
          {msg}
        </div>
      ) : null}
    </div>
  );
}
