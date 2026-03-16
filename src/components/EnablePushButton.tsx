"use client";

import { useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import {
  askNotificationPermission,
  registerServiceWorker,
  subscribeToPush,
} from "@/lib/push-client";

export default function EnablePushButton({ role }: { role: "admin" | "driver" }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function enablePush() {
    try {
      setBusy(true);
      setMsg(null);

      const { data } = await supabaseClient.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Not logged in.");

      await askNotificationPermission();
      const registration = await registerServiceWorker();
      const subscription = await subscribeToPush(registration);

      const res = await fetch("/api/push/save-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          role,
          subscription: subscription.toJSON(),
        }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to save subscription.");

      setMsg("Push notifications enabled successfully.");
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={enablePush}
        disabled={busy}
        className="rounded-xl px-4 py-2 text-white"
        style={{ background: "var(--moovu-primary)" }}
      >
        {busy ? "Enabling..." : "Enable Phone Notifications"}
      </button>
      {msg ? <div className="text-sm text-gray-700">{msg}</div> : null}
    </div>
  );
}