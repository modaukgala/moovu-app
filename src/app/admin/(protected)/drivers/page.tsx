"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import type { DriverStage } from "@/lib/admin/driverDirectory";

type Row = {
  id: string; name: string; nameFromRecord: boolean; phone: string | null; email: string | null;
  system: "new" | "old"; stage: DriverStage; stageLabel: string; missing: string[]; linked: boolean;
  online: boolean; busy: boolean; lastSeen: string | null; vehicle: string | null; joined: string | null; removed: boolean;
  applicationUpdated: string | null;
  deletionRequest: { reason: string; at: string } | null;
};
type OldApp = { id: string; name: string | null; phone: string | null; email: string | null; status: string | null; created_at: string };

const TABS: { key: string; label: string; match: (r: Row) => boolean }[] = [
  { key: "active", label: "Active", match: r => r.stage === "active" },
  { key: "review", label: "Waiting for review", match: r => r.stage === "review" },
  { key: "onboarding", label: "Still applying", match: r => r.stage === "draft" || r.stage === "corrections" },
  { key: "not_started", label: "Signed up, not started", match: r => r.stage === "not_started" },
  { key: "old", label: "Old system", match: r => r.system === "old" },
  { key: "off", label: "Deactivated & rejected", match: r => r.stage === "deactivated" || r.stage === "rejected" },
  { key: "delete", label: "Asked to delete account", match: r => Boolean(r.deletionRequest) },
  { key: "all", label: "Everyone", match: () => true },
];

const TONE: Record<DriverStage, string> = {
  active: "is-done", review: "is-waiting", corrections: "is-waiting", draft: "", not_started: "",
  deactivated: "is-off", rejected: "is-off", old_system: "",
};

const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "–";

export default function AdminDriversPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [oldApps, setOldApps] = useState<OldApp[]>([]);
  const [tab, setTab] = useState("active");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadDrivers = useCallback(async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch("/api/admin/drivers/directory", { cache: "no-store", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (json?.ok) { setRows(json.drivers); setOldApps(json.oldApplications ?? []); setError(null); } else setError(json?.error ?? "Couldn't load drivers.");
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void loadDrivers(), 0); return () => window.clearTimeout(t); }, [loadDrivers]);

  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, (rows ?? []).filter(t.match).length])), [rows]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const active = TABS.find(t => t.key === tab) ?? TABS[0];
    return (rows ?? []).filter(r => term ? `${r.name} ${r.phone ?? ""} ${r.email ?? ""} ${r.vehicle ?? ""}`.toLowerCase().includes(term) : active.match(r));
  }, [rows, tab, q]);

  return (
    <div className="ad-page">
      <header className="ad-head flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Drivers</h1>
          <p>Everyone who drives or applied to drive, from the old and new onboarding, in one list.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/onboarding" className="ad-btn">Review applications</Link>
          <Link href="/admin/link-driver" className="ad-btn">Link a login</Link>
        </div>
      </header>

      <section className="ad-stats">
        <button type="button" className="ad-stat text-left" onClick={() => setTab("active")}><small>Active drivers</small><strong>{counts.active ?? "–"}</strong></button>
        <button type="button" className={`ad-stat text-left${(counts.review ?? 0) > 0 ? " is-attention" : ""}`} onClick={() => setTab("review")}><small>Waiting for your review</small><strong>{counts.review ?? "–"}</strong></button>
        <button type="button" className="ad-stat text-left" onClick={() => setTab("onboarding")}><small>Still applying</small><strong>{counts.onboarding ?? "–"}</strong></button>
        <div className="ad-stat"><small>Online now</small><strong>{rows ? rows.filter(r => r.online).length : "–"}</strong></div>
      </section>

      <section className="ad-card space-y-3">
        <input type="search" className="w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="Search name, phone, email or car"
          value={q} onChange={e => setQ(e.target.value)} aria-label="Search drivers" />
        {!q && (
          <div className="ad-tabs">
            {TABS.map(t => <button key={t.key} type="button" className={tab === t.key ? "is-on" : ""} onClick={() => setTab(t.key)}>{t.label} ({counts[t.key] ?? 0})</button>)}
            {oldApps.length > 0 && <button type="button" className={tab === "oldapps" ? "is-on" : ""} onClick={() => setTab("oldapps")}>Old applications, no account ({oldApps.length})</button>}
          </div>
        )}
        {error && <p className="ad-empty">{error}</p>}
        {!rows && !error && <p className="ad-empty">Loading drivers…</p>}

        {tab === "oldapps" && !q ? (
          <div className="ad-rows">
            <p className="ad-note">These people applied through the old system but never made a driver account. Contact them to apply in the new driver app.</p>
            {oldApps.map(a => (
              <div key={a.id} className="ad-row">
                <div><div className="ad-row-title">{a.name ?? "No name"}</div><div className="ad-row-sub">{[a.phone, a.email].filter(Boolean).join(" · ")} · applied {day(a.created_at)}</div></div>
                {a.phone && <div className="ad-row-actions"><a className="ad-btn" href={`tel:${a.phone}`}>Call</a></div>}
              </div>
            ))}
          </div>
        ) : rows && shown.length === 0 ? <p className="ad-empty">No drivers here.</p> : (
          <div className="ad-rows">
            {shown.map(r => (
              <article key={r.id} className="ad-row">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/drivers/${r.id}`} className="ad-row-title hover:underline">{r.name}</Link>
                    <span className={`ad-badge ${TONE[r.stage]}`}>{r.stageLabel}</span>
                    <span className="ad-badge">{r.system === "new" ? "New onboarding" : "Old system"}</span>
                    {r.online && <span className="ad-badge is-live">{r.busy ? "On a trip" : "Online"}</span>}
                    {!r.linked && <span className="ad-badge is-off">No login linked</span>}
                    {r.deletionRequest && <span className="ad-badge is-off">Asked to delete account</span>}
                  </div>
                  <div className="ad-row-sub">{[r.phone, r.email, r.vehicle].filter(Boolean).join(" · ") || "No contact details"} · joined {day(r.joined)}</div>
                  {r.missing.length > 0 && (
                    <div className="ad-row-sub">Missing {r.missing.length}: {r.missing.slice(0, 4).join(", ")}{r.missing.length > 4 ? "…" : ""}</div>
                  )}
                </div>
                <div className="ad-row-actions">
                  {r.stage === "review" && <Link href="/admin/onboarding" className="ad-btn is-primary">Review</Link>}
                  <Link href={`/admin/drivers/${r.id}`} className="ad-btn">Open</Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
