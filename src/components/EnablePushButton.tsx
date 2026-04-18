"use client";

import { useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type Role = "admin" | "driver" | "customer";

type Props = {
  role: Role;
  className?: string;
  onEnabled?: () => void;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export default function EnablePushButton({
  role,
  className = "",
  onEnabled,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
      setHidden(true);
    }
  }, []);

  async function handleEnablePush() {
    try {
      setBusy(true);
      setMsg("");

      if (!("serviceWorker" in navigator)) {
        setMsg("This browser does not support service workers.");
        return;
      }

      if (!("PushManager" in window)) {
        setMsg("This browser does not support push notifications.");
        return;
      }

      const {
        data: { session },
        error: sessionErr,
      } = await supabaseClient.auth.getSession();

      if (sessionErr) {
        setMsg(`Session error: ${sessionErr.message}`);
        return;
      }

      if (!session?.access_token) {
        setMsg("No active login session found for this portal.");
        return;
      }

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        setMsg("Push notifications are not configured.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMsg("Notification permission was not granted.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }

      const subscribeRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          role,
          subscription: subscription.toJSON(),
        }),
      });

      const subscribeJson = await subscribeRes.json().catch(() => null);

      if (!subscribeRes.ok || !subscribeJson?.ok) {
        setMsg(subscribeJson?.error || "Failed to save subscription.");
        return;
      }

      const testRes = await fetch("/api/push/test-self", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ role }),
      });

      const testJson = await testRes.json().catch(() => null);

      if (!testRes.ok || !testJson?.ok) {
        setMsg(
          testJson?.error ||
            `${subscribeJson?.message || "Subscription saved."} Test notification failed.`
        );
        return;
      }

      setMsg("Notifications enabled successfully.");
      setHidden(true);
      onEnabled?.();
    } catch (e: any) {
      setMsg(e?.message || "Failed to enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  if (hidden) return null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleEnablePush}
        disabled={busy}
        className="rounded-full px-4 py-3 text-sm font-medium text-white shadow-lg disabled:opacity-60"
        style={{ background: "var(--moovu-primary)" }}
      >
        {busy ? "Enabling..." : "Enable push notifications"}
      </button>

      {msg ? (
        <p className="mt-2 max-w-[260px] rounded-lg bg-white/95 px-3 py-2 text-xs text-gray-700 shadow">
          {msg}
        </p>
      ) : null}
    </div>
  );
}