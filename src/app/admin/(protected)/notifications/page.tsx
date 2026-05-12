"use client";

import { useCallback, useEffect, useState } from "react";
import EnableNotificationsButton from "@/components/EnableNotificationsButton";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type NotificationStatus = {
  ok: boolean;
  userId?: string;
  activeTokenCount?: number;
  tokens?: Array<{
    id: string;
    role: string;
    token: string;
    platform: string | null;
    device_id: string | null;
    app_source: string | null;
    is_active: boolean;
    last_used_at: string | null;
    updated_at: string | null;
  }>;
  error?: string;
};

export default function AdminNotificationsPage() {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [role, setRole] = useState<"admin" | "driver" | "customer">("admin");
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    return session?.access_token ?? "";
  }, []);

  const loadStatus = useCallback(async () => {
    setMessage(null);
    const accessToken = await getAccessToken();
    if (!accessToken) {
      setMessage("Missing login session.");
      return;
    }

    const response = await fetch(`/api/notifications/status?role=admin`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const json = (await response.json().catch(() => null)) as NotificationStatus | null;
    setStatus(json);
    if (!response.ok || !json?.ok) {
      setMessage(json?.error || "Failed to load notification status.");
    }
  }, [getAccessToken]);

  async function sendRoleTest() {
    setSending(true);
    setMessage(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setMessage("Missing login session.");
        return;
      }

      const response = await fetch("/api/notifications/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          role,
          title: "MOOVU test notification",
          body: `Test notification for ${role}.`,
          url: role === "driver" ? "/driver" : role === "admin" ? "/admin" : "/book",
          data: {
            type: "notification_test",
            role,
          },
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        setMessage(json?.error || json?.message || "Test notification failed.");
        return;
      }

      setMessage(`Sent. Delivered: ${json.delivered ?? 0}, failed: ${json.failed ?? 0}.`);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  return (
    <main className="space-y-6 text-black">
      {message && <CenteredMessageBox message={message} onClose={() => setMessage(null)} />}

      <section className="moovu-hero-panel p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-white/70">
              Notifications
            </div>
            <h1 className="mt-3 max-w-3xl text-3xl font-black tracking-tight text-white sm:text-5xl">
              Test Firebase push delivery before production rollout.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/74">
              Admin protected utility for checking token registration and role-based delivery.
            </p>
          </div>

          <EnableNotificationsButton role="admin" variant="inline" />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="moovu-card-interactive p-5">
          <div className="moovu-section-title">Current admin device</div>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Token status</h2>
          <p className="mt-2 text-sm text-slate-600">
            Active tokens: {status?.activeTokenCount ?? 0}
          </p>

          <div className="mt-4 space-y-3">
            {(status?.tokens ?? []).length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                No saved admin tokens found for this account yet.
              </div>
            ) : (
              status!.tokens!.map((token) => (
                <div key={token.id} className="rounded-2xl border border-[var(--moovu-border)] bg-white p-4 text-sm">
                  <div className="font-black text-slate-950">{token.token}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {token.platform ?? "unknown"} · {token.app_source ?? "no source"} · {token.is_active ? "active" : "inactive"}
                  </div>
                </div>
              ))
            )}
          </div>

          <button type="button" onClick={() => void loadStatus()} className="moovu-btn moovu-btn-secondary mt-4">
            Refresh token status
          </button>
        </div>

        <div className="moovu-card-interactive p-5">
          <div className="moovu-section-title">Delivery test</div>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Send role test</h2>

          <label className="mt-4 block text-sm font-bold text-slate-700" htmlFor="notification-role">
            Target role
          </label>
          <select
            id="notification-role"
            className="moovu-input mt-2"
            value={role}
            onChange={(event) => setRole(event.target.value as "admin" | "driver" | "customer")}
          >
            <option value="admin">Admin</option>
            <option value="driver">Driver</option>
            <option value="customer">Customer</option>
          </select>

          <button
            type="button"
            onClick={() => void sendRoleTest()}
            disabled={sending}
            className="moovu-btn moovu-btn-primary mt-4"
          >
            {sending ? "Sending..." : "Send test notification"}
          </button>
        </div>
      </section>
    </main>
  );
}
