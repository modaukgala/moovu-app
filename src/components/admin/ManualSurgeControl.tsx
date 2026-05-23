"use client";

import { useCallback, useEffect, useState } from "react";
import { SURGE_MODES, type SurgeMode, type SurgeModeConfig } from "@/lib/domain/fare";
import { supabaseClient } from "@/lib/supabase/client";

type SurgeResponse = {
  ok?: boolean;
  surge?: SurgeModeConfig;
  modes?: SurgeModeConfig[];
  error?: string;
};

const DEFAULT_MODES = Object.values(SURGE_MODES);

export default function ManualSurgeControl() {
  const [surge, setSurge] = useState<SurgeModeConfig>(SURGE_MODES.normal);
  const [modes, setModes] = useState<SurgeModeConfig[]>(DEFAULT_MODES);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState<SurgeMode | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    return session?.access_token || "";
  }, []);

  const loadSurge = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    const token = await getAccessToken();
    if (!token) {
      setMessage("Admin session required to load pricing.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/admin/pricing/surge", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => null)) as SurgeResponse | null;
    if (!json?.ok || !json.surge) {
      setMessage(json?.error || "Could not load manual surge.");
      setLoading(false);
      return;
    }

    setSurge(json.surge);
    setModes(json.modes?.length ? json.modes : DEFAULT_MODES);
    setLoading(false);
  }, [getAccessToken]);

  async function saveSurge(mode: SurgeMode) {
    setSavingMode(mode);
    setMessage(null);
    const token = await getAccessToken();
    if (!token) {
      setMessage("Admin session required to update pricing.");
      setSavingMode(null);
      return;
    }

    const res = await fetch("/api/admin/pricing/surge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ mode }),
    });
    const json = (await res.json().catch(() => null)) as SurgeResponse | null;
    if (!json?.ok || !json.surge) {
      setMessage(json?.error || "Could not update manual surge.");
      setSavingMode(null);
      return;
    }

    setSurge(json.surge);
    setModes(json.modes?.length ? json.modes : DEFAULT_MODES);
    setMessage(`${json.surge.label} pricing will apply to new bookings only.`);
    setSavingMode(null);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSurge();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadSurge]);

  return (
    <section className="moovu-card-interactive p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="moovu-section-title">Manual pricing control</div>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Surge mode</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Current setting: <strong className="text-slate-950">{surge.label}</strong>{" "}
            <span className="font-bold text-slate-500">x{surge.multiplier.toFixed(1)}</span>. This applies only to new bookings.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void saveSurge("normal")}
          className="moovu-btn moovu-btn-secondary"
          disabled={savingMode != null || surge.mode === "normal"}
        >
          Reset to Normal
        </button>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {modes.map((mode) => {
          const active = surge.mode === mode.mode;
          return (
            <button
              key={mode.mode}
              type="button"
              onClick={() => void saveSurge(mode.mode)}
              disabled={loading || savingMode != null}
              className={`rounded-3xl border p-4 text-left transition ${
                active
                  ? "border-[var(--moovu-primary)] bg-[var(--moovu-primary-soft)] shadow-[0_14px_35px_rgba(31,116,201,0.16)]"
                  : "border-[var(--moovu-border)] bg-white hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-black text-slate-950">{mode.label}</div>
                <div className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-700">
                  x{mode.multiplier.toFixed(1)}
                </div>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{mode.message}</p>
              <div className="mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                {savingMode === mode.mode ? "Saving..." : active ? "Active" : "Set mode"}
              </div>
            </button>
          );
        })}
      </div>

      {message && (
        <div className="mt-4 rounded-2xl bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">
          {message}
        </div>
      )}
    </section>
  );
}
