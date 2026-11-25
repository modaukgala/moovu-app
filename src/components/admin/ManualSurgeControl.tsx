"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SURGE_MODES, type SurgeMode, type SurgeModeConfig } from "@/lib/domain/fare";
import { supabaseClient } from "@/lib/supabase/client";
import { requestSurge } from "@/lib/admin/surgeRequest";

type Setting = {
  surge: SurgeModeConfig; state: "configured" | "absent" | "malformed" | "failed";
  updatedBy?: string | null; updatedAt?: string | null;
};

const labels = {
  configured: "Saved setting", absent: "No saved setting · effective fallback",
  malformed: "Invalid saved setting · effective fallback",
  failed: "Saved setting unavailable · effective fallback",
};

async function token() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session?.access_token ?? "";
}

export default function ManualSurgeControl() {
  const [setting, setSetting] = useState<Setting | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const read = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    try {
      const current = await requestSurge<Setting>(token, controller.signal);
      if (read.current === controller) setSetting(current);
    } catch {
      if (read.current === controller) setSetting(null);
    } finally {
      if (read.current === controller) setLoading(false);
    }
  }, []);

  async function save(mode: SurgeMode) {
    if (write.current || loading || !setting || setting.state === "failed") return;
    const controller = new AbortController();
    write.current = controller;
    setSaving(true);
    setMessage(null);
    try {
      const result = await requestSurge<Setting>(token, controller.signal, mode);
      if (!controller.signal.aborted) {
        setSetting(result);
        setMessage(`${result.surge.label} applies to new bookings.`);
      }
    } catch {
      if (!controller.signal.aborted) {
        setMessage("The change was not confirmed. Refreshing the saved setting.");
        await refresh();
        if (!controller.signal.aborted) setMessage("The change was not confirmed. Review the saved state before making another change.");
      }
    } finally {
      if (write.current === controller) {
        write.current = null;
        setSaving(false);
      }
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => {
      clearTimeout(timer);
      read.current?.abort();
      read.current = null;
      write.current?.abort();
      write.current = null;
    };
  }, [refresh]);

  return <section id="manual-surge" className="moovu-card p-5 space-y-3" aria-busy={loading || saving}>
    <h2 className="text-xl font-semibold">Manual surge</h2>
    {loading ? <p role="status">Reading saved pricing…</p> : setting
      ? <p>{labels[setting.state]} · {setting.surge.label} ×{setting.surge.multiplier.toFixed(1)}</p>
      : <p role="alert">Saved pricing could not be read.</p>}
    {setting?.updatedAt && <p className="text-sm">Last saved {setting.updatedAt} · updater {setting.updatedBy ?? "Unknown"}</p>}
    <div className="flex flex-wrap gap-2">
      {Object.values(SURGE_MODES).map(mode => <button key={mode.mode} type="button" className="moovu-btn moovu-btn-secondary"
        disabled={loading || saving || !setting || setting.state === "failed"}
        aria-pressed={setting?.state === "configured" && setting.surge.mode === mode.mode}
        onClick={() => void save(mode.mode)}>{mode.label} ×{mode.multiplier.toFixed(1)}</button>)}
      <button type="button" className="moovu-btn moovu-btn-secondary" disabled={loading || saving}
        onClick={() => void refresh()}>Refresh saved pricing</button>
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}
