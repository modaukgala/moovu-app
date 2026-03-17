"use client";

import { useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type Props = {
  role: "admin" | "driver" | "customer";
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

export default function EnablePushButton({ role }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function enableNotifications() {
    setBusy(true);
    setMsg(null);

    try {
      if (!("serviceWorker" in navigator)) {
        setMsg("Service worker not supported on this device/browser.");
        setBusy(false);
        return;
      }

      if (!("PushManager" in window)) {
        setMsg("Push notifications are not supported on this device/browser.");
        setBusy(false);
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMsg("Notification permission was not granted.");
        setBusy(false);
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      let subscription = await reg.pushManager.getSubscription();

      if (!subscription) {
        const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
        if (!vapidPublicKey) {
          setMsg("Missing public VAPID key.");
          setBusy(false);
          return;
        }

        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }

      const { data: userData, error: userErr } = await supabaseClient.auth.getUser();
      if (userErr || !userData.user) {
        setMsg("You must be logged in first.");
        setBusy(false);
        return;
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role,
          userId: userData.user.id,
          subscription: subscription.toJSON(),
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        setMsg(json.error || "Failed to save push subscription.");
        setBusy(false);
        return;
      }

      setMsg("Notifications enabled ✅");
      setBusy(false);
    } catch (e: any) {
      setMsg(e?.message || "Failed to enable notifications.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={enableNotifications}
        className="rounded-xl px-4 py-2 text-white"
        style={{ background: "var(--moovu-primary)" }}
      >
        {busy ? "Enabling..." : "Enable Notifications"}
      </button>

      {msg && <div className="text-sm text-gray-700">{msg}</div>}
    </div>
  );
}