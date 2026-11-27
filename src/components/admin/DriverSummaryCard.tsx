"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import type { DriverStage } from "@/lib/admin/driverDirectory";

type Summary = {
  id: string; name: string; nameFromRecord: boolean; phone: string | null; email: string | null; system: "new" | "old";
  stage: DriverStage; stageLabel: string; missing: string[]; linked: boolean; online: boolean; busy: boolean;
  lastSeen: string | null; vehicle: string | null; joined: string | null; applicationUpdated: string | null;
};

async function api(url: string, init?: RequestInit) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const res = await fetch(url, {
    ...init, cache: "no-store",
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  }).catch(() => null);
  return res?.json().catch(() => null) ?? null;
}

const day = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";

/** Everything important about one driver at a glance: stage, what's missing, contact, and safe actions. */
export default function DriverSummaryCard({ driverId }: { driverId: string }) {
  const [d, setD] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState({ firstName: "", lastName: "" });

  const load = useCallback(async () => {
    const json = await api(`/api/admin/drivers/directory?driverId=${encodeURIComponent(driverId)}`);
    if (json?.ok && json.driver) { setD(json.driver); setError(null); } else setError(json?.error ?? "Driver summary unavailable.");
  }, [driverId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  function startEdit() {
    const parts = (d?.name ?? "").replace(/^No name yet.*$/, "").trim().split(/\s+/);
    setNames({ firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") });
    setEditing(true);
  }

  async function saveName() {
    setBusy(true); setNotice(null);
    const json = await api("/api/admin/drivers/name", { method: "POST", body: JSON.stringify({ driverId, ...names }) });
    setBusy(false);
    setNotice(json?.ok ? "Name saved." : json?.error ?? "Couldn't save the name.");
    if (json?.ok) { setEditing(false); void load(); }
  }

  async function setActive(active: boolean) {
    const reason = window.prompt(active ? "Why are you reactivating this driver?" : "Why are you deactivating this driver? They won't get trips until reactivated.");
    if (!reason || reason.trim().length < 8) { if (reason !== null) setNotice("Please give a reason of at least 8 characters."); return; }
    setBusy(true); setNotice(null);
    const json = await api("/api/admin/drivers/status", { method: "POST", body: JSON.stringify({ driverId, status: active ? "active" : "inactive", reason }) });
    setBusy(false);
    setNotice(json?.ok ? (active ? "Driver reactivated." : "Driver deactivated. They can't receive trips.") : json?.error ?? "Couldn't change the driver's status.");
    if (json?.ok) void load();
  }

  if (error) return <section className="ad-card"><p className="ad-empty">{error}</p></section>;
  if (!d) return <section className="ad-card"><p className="ad-empty">Loading driver…</p></section>;

  return (
    <section className="ad-card space-y-4" aria-label="Driver summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/drivers" className="ad-note font-bold">← Drivers</Link>
          <h1 className="text-2xl font-black">{d.name}</h1>
          <div className="mt-1 flex flex-wrap gap-2">
            <span className={`ad-badge ${d.stage === "active" ? "is-done" : d.stage === "review" || d.stage === "corrections" ? "is-waiting" : d.stage === "deactivated" || d.stage === "rejected" ? "is-off" : ""}`}>{d.stageLabel}</span>
            <span className="ad-badge">{d.system === "new" ? "New onboarding" : "Old system"}</span>
            {d.online && <span className="ad-badge is-live">{d.busy ? "On a trip" : "Online"}</span>}
            {!d.linked && <span className="ad-badge is-off">No login linked</span>}
          </div>
        </div>
        <div className="ad-row-actions">
          {d.phone && <a className="ad-btn" href={`tel:${d.phone}`}>Call</a>}
          <button type="button" className="ad-btn" onClick={startEdit}>Fix name</button>
          {d.stage === "review" && <Link className="ad-btn is-primary" href="/admin/onboarding">Review application</Link>}
          {d.stage === "active" && <button type="button" className="ad-btn" style={{ color: "#b91c1c" }} disabled={busy} onClick={() => setActive(false)}>Deactivate</button>}
          {d.stage === "deactivated" && <button type="button" className="ad-btn" disabled={busy} onClick={() => setActive(true)}>Reactivate</button>}
          {!d.linked && <Link className="ad-btn" href="/admin/link-driver">Link login</Link>}
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="ad-note">Phone</dt><dd className="font-semibold">{d.phone ?? "–"}</dd></div>
        <div><dt className="ad-note">Email</dt><dd className="font-semibold break-all">{d.email ?? "–"}</dd></div>
        <div><dt className="ad-note">Car</dt><dd className="font-semibold">{d.vehicle ?? "–"}</dd></div>
        <div><dt className="ad-note">Joined</dt><dd className="font-semibold">{day(d.joined)}</dd></div>
        <div><dt className="ad-note">Last seen in the app</dt><dd className="font-semibold">{day(d.lastSeen)}</dd></div>
        <div><dt className="ad-note">Application last changed</dt><dd className="font-semibold">{day(d.applicationUpdated)}</dd></div>
      </dl>

      {d.missing.length > 0 && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm">
          <p className="font-black text-amber-900">Their application is missing {d.missing.length} item{d.missing.length === 1 ? "" : "s"}:</p>
          <ul className="mt-1 list-disc pl-5 text-amber-900">{d.missing.map(item => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
      {d.stage === "not_started" && <p className="ad-note">They created a driver login but haven&apos;t filled in anything yet.</p>}
      {!d.nameFromRecord && d.stage !== "not_started" && <p className="ad-note">The name shown comes from their application. Tap Fix name to save it on their driver record.</p>}

      {editing && (
        <div className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
          <input className="rounded-xl border px-3 py-2" placeholder="First name" value={names.firstName} onChange={e => setNames(n => ({ ...n, firstName: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2" placeholder="Surname" value={names.lastName} onChange={e => setNames(n => ({ ...n, lastName: e.target.value }))} />
          <div className="flex gap-2">
            <button type="button" className="ad-btn is-primary" disabled={busy} onClick={saveName}>Save</button>
            <button type="button" className="ad-btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          <p className="ad-note sm:col-span-3">Other details (ID, licence, car) are changed by sending the application back for corrections, so the driver re-confirms them.</p>
        </div>
      )}
      {notice && <p className="text-sm font-semibold" role="status">{notice}</p>}
    </section>
  );
}
