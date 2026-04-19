"use client";

import { useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type Role = "admin" | "driver" | "customer";

type Props = {
  role: Role;
  onEnabled?: () => void;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function EnablePushButton({ role, onEnabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && Notification.permission === "granted") {
      setHidden(true);
    }
  }, []);

  async function handleClick() {
    try {
      setBusy(true);

      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!session?.access_token) {
        alert("You must be logged in.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        alert("Permission denied.");
        return;
      }

      const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid!),
        });
      }

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          role,
          subscription: sub.toJSON(),
        }),
      });

      await fetch("/api/push/test-self", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      setHidden(true);
      onEnabled?.();
    } catch (e) {
      console.error(e);
      alert("Failed to enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  if (hidden) return null;

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="rounded-full px-4 py-3 text-white shadow-lg"
      style={{ background: "#0B5FFF" }}
    >
      {busy ? "Enabling..." : "Enable notifications"}
    </button>
  );
}