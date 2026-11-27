"use client";

import { useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type Hit = { kind: "customer" | "driver"; id: string; name: string; phone: string | null };
type Device = { platform: string | null; app: string | null; lastSeen: string | null };
type Result = { delivered: number; failed: number; removed?: number; reasons?: string[]; devices: Device[]; explanation: string };

async function api(url: string, init?: RequestInit) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const res = await fetch(url, {
    ...init, cache: "no-store",
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  }).catch(() => null);
  return res?.json().catch(() => null) ?? null;
}

const APP: Record<string, string> = {
  android_customer: "Android · customer app", ios_customer: "iPhone · customer app", web_customer: "Web browser",
  android_driver: "Android · driver app", ios_driver: "iPhone · driver app", web_driver: "Web browser", web_admin: "Web browser · admin",
};

/** Send one test notification to one chosen person and see what happened on each of their phones. */
export default function NotificationPersonTest() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [chosen, setChosen] = useState<{ kind: "me" } | Hit | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { const t = window.setTimeout(() => setHits([]), 0); return () => window.clearTimeout(t); }
    const t = window.setTimeout(async () => {
      const json = await api(`/api/admin/search?q=${encodeURIComponent(q.trim())}`);
      if (!json?.ok) return;
      setHits([
        ...json.customers.map((c: { id: string; name: string; phone: string | null }) => ({ kind: "customer" as const, ...c })),
        ...json.drivers.map((d: { id: string; name: string; phone: string | null }) => ({ kind: "driver" as const, ...d })),
      ]);
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  async function choose(target: { kind: "me" } | Hit) {
    setChosen(target); setResult(null); setDevices(null); setProblem(null); setHits([]); setQ("");
    const params = new URLSearchParams({ kind: target.kind, ...(target.kind === "me" ? {} : { id: target.id }) });
    const json = await api(`/api/admin/notifications/test-person?${params}`);
    if (json?.ok) { setDevices(json.devices ?? []); setProblem(json.problem ?? null); } else setProblem(json?.error ?? "Couldn't look this person up.");
  }

  async function send() {
    if (!chosen) return;
    setBusy(true); setResult(null);
    const json = await api("/api/admin/notifications/test-person", { method: "POST", body: JSON.stringify(chosen.kind === "me" ? { kind: "me" } : { kind: chosen.kind, id: chosen.id }) });
    setBusy(false);
    if (json?.ok) { setResult(json); setDevices(json.devices); } else setProblem(json?.error ?? "The test couldn't be sent.");
  }

  const label = chosen ? (chosen.kind === "me" ? "You (this admin login)" : `${chosen.name} · ${chosen.kind}`) : null;

  return (
    <section className="ad-card space-y-3" aria-label="Send a test notification">
      <div className="ad-card-head"><h2>Send a test to one person</h2></div>
      <p className="ad-note">Search for the customer or driver who says they get no notifications. The test goes to that one person only, never to everyone.</p>
      <div className="flex flex-wrap gap-2">
        <input type="search" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4 py-3" placeholder="Name or phone number"
          value={q} onChange={e => setQ(e.target.value)} aria-label="Find a person" />
        <button type="button" className="ad-btn" onClick={() => void choose({ kind: "me" })}>Test on my own device</button>
      </div>
      {hits.length > 0 && (
        <div className="ad-rows">
          {hits.map(h => (
            <button key={`${h.kind}-${h.id}`} type="button" className="ad-row text-left" onClick={() => void choose(h)}>
              <span><span className="ad-row-title">{h.name}</span><span className="ad-row-sub block">{h.kind === "driver" ? "Driver" : "Customer"}{h.phone ? ` · ${h.phone}` : ""}</span></span>
              <span className="ad-btn">Choose</span>
            </button>
          ))}
        </div>
      )}

      {chosen && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-3">
          <p className="font-black">{label}</p>
          {problem && <p className="text-sm font-semibold text-red-700">{problem}</p>}
          {devices && devices.length === 0 && !problem && (
            <p className="text-sm text-amber-900">No phone is registered for notifications. Ask them to open the MOOVU app, sign in, and tap Allow when it asks about notifications.</p>
          )}
          {devices && devices.length > 0 && (
            <ul className="space-y-1 text-sm">
              {devices.map((d, i) => (
                <li key={i}>📱 {APP[d.app ?? ""] ?? d.platform ?? "Device"}{d.lastSeen ? ` · last active ${new Date(d.lastSeen).toLocaleString("en-ZA")}` : ""}</li>
              ))}
            </ul>
          )}
          {!problem && <button type="button" className="ad-btn is-primary" disabled={busy || devices === null} onClick={send}>{busy ? "Sending…" : "Send test notification"}</button>}
          {result && (
            <div className={`rounded-xl p-3 text-sm ${result.delivered > 0 ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`} role="status">
              <p className="font-bold">{result.delivered > 0 ? "Sent ✓" : "Not delivered"}</p>
              <p>{result.explanation}</p>
              {result.reasons && result.reasons.length > 0 && <p className="mt-1 text-xs">Details: {result.reasons.join("; ")}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
