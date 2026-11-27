"use client";

import { useCallback, useEffect, useState } from "react";
import NotificationPersonTest from "@/components/admin/NotificationPersonTest";
import EnableNotificationsButton from "@/components/EnableNotificationsButton";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
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

type NotificationLog = {
  id: string;
  user_id: string | null;
  role: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  delivery_status: string | null;
  error_message: string | null;
  created_at: string | null;
};

type NotificationLogsResponse = {
  ok?: boolean;
  logs?: NotificationLog[];
  summary?: {
    total: number;
    failed: number;
    noTokens: number;
    sent: number;
  };
  warning?: string;
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "--";
  return new Date(value).toLocaleString();
}

export default function AdminNotificationsPage() {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [logsSummary, setLogsSummary] = useState<NotificationLogsResponse["summary"] | null>(null);
  const [logsWarning, setLogsWarning] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<"all" | "failed" | "no_tokens" | "sent">("all");

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

  const loadLogs = useCallback(async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      setLogs([]);
      return;
    }

    const response = await fetch(`/api/admin/notifications/logs?status=${logFilter}&limit=50`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const json = (await response.json().catch(() => null)) as NotificationLogsResponse | null;
    if (!response.ok || !json?.ok) {
      setLogs([]);
      setLogsSummary(null);
      setLogsWarning(json?.error || "Could not load notification logs.");
      return;
    }

    setLogs(json.logs ?? []);
    setLogsSummary(json.summary ?? null);
    setLogsWarning(json.warning ?? null);
  }, [getAccessToken, logFilter]);

  useEffect(() => {
    const t = window.setTimeout(() => void loadStatus(), 0);
    return () => window.clearTimeout(t);
  }, [loadStatus]);

  useEffect(() => {
    const t = window.setTimeout(() => void loadLogs(), 0);
    return () => window.clearTimeout(t);
  }, [loadLogs]);

  return (
    <main className="ad-page text-black">
      {message && <CenteredMessageBox message={message} onClose={() => setMessage(null)} />}

      <section className="ad-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="ad-head">
            <h1>Notification check</h1>
            <p>Use this when someone says they aren&apos;t getting notifications. It shows whether this device can receive alerts, and lets you send a test notification to admins, drivers or customers to see if it arrives.</p>
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

      </section>

      <NotificationPersonTest />

      <section className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Recent logs" value={String(logsSummary?.total ?? logs.length)} helper="Current filter" />
          <MetricCard label="Delivered" value={String(logsSummary?.sent ?? 0)} helper="Recorded sent attempts" tone="success" />
          <MetricCard label="No tokens" value={String(logsSummary?.noTokens ?? 0)} helper="Users without saved devices" tone="warning" />
          <MetricCard label="Failed" value={String(logsSummary?.failed ?? 0)} helper="Needs attention" tone={(logsSummary?.failed ?? 0) > 0 ? "danger" : "default"} />
        </div>

        <div className="moovu-card p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="moovu-section-title">Delivery history</div>
              <h2 className="mt-2 text-2xl font-black text-slate-950">Notification logs</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Review failed sends, missing-token cases, and recent delivery attempts without exposing private credentials.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {(["all", "failed", "no_tokens", "sent"] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setLogFilter(filter)}
                  className={`rounded-xl border px-3 py-2 text-xs font-black capitalize transition ${
                    logFilter === filter
                      ? "border-[var(--moovu-blue)] bg-[var(--moovu-blue)] text-white"
                      : "border-[var(--moovu-border)] bg-white text-slate-700"
                  }`}
                >
                  {filter.replace("_", " ")}
                </button>
              ))}
              <button type="button" onClick={() => void loadLogs()} className="moovu-btn moovu-btn-secondary">
                Refresh
              </button>
            </div>
          </div>

          {logsWarning ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
              {logsWarning}
            </div>
          ) : null}

          <div className="mt-5 space-y-3">
            {logs.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-600">
                No notification logs found for this filter.
              </div>
            ) : (
              logs.map((row) => (
                <div
                  key={row.id}
                  className="rounded-2xl border border-[var(--moovu-border)] bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={row.delivery_status ?? "queued"} />
                        <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                          {row.role ?? "unknown role"}
                        </span>
                      </div>
                      <div className="mt-2 font-black text-slate-950">{row.title ?? "Untitled notification"}</div>
                      <div className="mt-1 text-sm text-slate-600">{row.body ?? "--"}</div>
                      {row.error_message ? (
                        <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                          {row.error_message}
                        </div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-xs font-semibold text-slate-500 sm:text-right">
                      <div>{formatDate(row.created_at)}</div>
                      <div className="mt-1">{row.url ?? "/"}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
