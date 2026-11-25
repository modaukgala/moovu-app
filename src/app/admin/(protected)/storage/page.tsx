"use client";

import { useCallback, useEffect, useState } from "react";
import { zipSync } from "fflate";
import { supabaseClient } from "@/lib/supabase/client";

type Doc = { path: string; size: number; mime: string; url: string | null; shrinkable: boolean };
type Summary = { count: number; totalBytes: number; shrinkableCount: number; shrinkableBytes: number; docs: Doc[] };

const PART_BYTES = 90 * 1024 * 1024; // ~90 MB per zip keeps the browser comfortable
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(0)} MB`;

function splitParts(docs: Doc[]) {
  const parts: Doc[][] = [];
  let cur: Doc[] = [], size = 0;
  for (const d of docs) {
    if (cur.length && size + d.size > PART_BYTES) { parts.push(cur); cur = []; size = 0; }
    cur.push(d); size += d.size;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

export default function AdminStoragePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [savedParts, setSavedParts] = useState<number[]>([]);
  const [busyPart, setBusyPart] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [shrinking, setShrinking] = useState(false);
  const [shrinkLog, setShrinkLog] = useState({ done: 0, saved: 0, failed: 0, remaining: 0 });

  const token = useCallback(async () => (await supabaseClient.auth.getSession()).data.session?.access_token ?? "", []);
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/storage/driver-docs?links=1", { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (body?.ok) setSummary(body); else setMsg(body?.error ?? "Could not load documents.");
  }, [token]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const parts = summary ? splitParts(summary.docs) : [];

  async function downloadPart(i: number) {
    setBusyPart(i); setMsg(null);
    try {
      const files: Record<string, Uint8Array> = {};
      for (const d of parts[i]) {
        if (!d.url) throw new Error(`No link for ${d.path}. Reload the page and try again.`);
        const r = await fetch(d.url);
        if (!r.ok) throw new Error(`Download failed for ${d.path}. Reload the page and try again.`);
        files[d.path] = new Uint8Array(await r.arrayBuffer());
      }
      const zipped = zipSync(files, { level: 0 });
      const blob = new Blob([zipped.slice().buffer], { type: "application/zip" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `moovu-driver-docs-backup-part-${i + 1}-of-${parts.length}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      setSavedParts((p) => Array.from(new Set([...p, i])));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Backup failed.");
    } finally { setBusyPart(null); }
  }

  async function shrinkAll() {
    setShrinking(true); setMsg(null);
    let done = 0, saved = 0, failed = 0, remaining = summary?.shrinkableCount ?? 0;
    try {
      for (let round = 0; round < 200 && remaining > 0; round++) {
        const res = await fetch("/api/admin/storage/driver-docs/shrink", {
          method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ confirmBackup: true }),
        });
        const body = await res.json().catch(() => null);
        if (!body?.ok) throw new Error(body?.error ?? "Shrinking stopped.");
        done += body.done.length; failed += body.failed.length;
        saved += body.done.reduce((a: number, d: { before: number; after: number }) => a + d.before - d.after, 0);
        remaining = body.remaining;
        setShrinkLog({ done, saved, failed, remaining });
        if (body.done.length === 0) break; // nothing more can be shrunk
      }
      setMsg("Finished. Storage has been reduced.");
      void load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Shrinking stopped.");
    } finally { setShrinking(false); }
  }

  const allSaved = parts.length > 0 && savedParts.length === parts.length;

  return (
    <div className="space-y-6 text-black">
      <div>
        <h1 className="text-2xl font-black">Storage: driver documents</h1>
        <p className="mt-1 text-sm text-slate-600">Step 1: download a backup. Step 2: shrink large photos so MOOVU stays under the Supabase storage limit.</p>
      </div>
      {msg && <p className="moovu-card p-3 text-sm font-bold">{msg}</p>}
      {!summary ? <p>Loading…</p> : (
        <>
          <div className="moovu-card p-5">
            <p className="text-sm text-slate-600">{summary.count} files · {mb(summary.totalBytes)} in total · {summary.shrinkableCount} large photos ({mb(summary.shrinkableBytes)}) can be shrunk</p>
          </div>

          <section className="moovu-card space-y-3 p-5">
            <h2 className="text-lg font-black">Step 1: Backup to this computer</h2>
            <p className="text-sm text-slate-600">Download every part. Each part is a zip of about 90 MB. Keep them somewhere safe and private: they contain drivers&apos; ID documents.</p>
            <div className="flex flex-wrap gap-2">
              {parts.map((p, i) => (
                <button key={i} type="button" className={`moovu-btn ${savedParts.includes(i) ? "moovu-btn-secondary" : "moovu-btn-primary"}`} disabled={busyPart !== null} onClick={() => void downloadPart(i)}>
                  {busyPart === i ? "Preparing…" : savedParts.includes(i) ? `Part ${i + 1} ✓` : `Download part ${i + 1} of ${parts.length}`}
                </button>
              ))}
            </div>
          </section>

          <section className="moovu-card space-y-3 p-5">
            <h2 className="text-lg font-black">Step 2: Shrink large photos</h2>
            <p className="text-sm text-slate-600">Large JPEG photos are resized to a maximum of 2000 pixels at good quality. PDFs and small files are not touched. This replaces the full-size originals and cannot be undone.</p>
            <label className="flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" checked={confirmed} disabled={!allSaved} onChange={(e) => setConfirmed(e.target.checked)} />
              I have saved all backup parts on my computer
            </label>
            <button type="button" className="moovu-btn moovu-btn-primary" disabled={!confirmed || shrinking || summary.shrinkableCount === 0} onClick={() => void shrinkAll()}>
              {shrinking ? "Shrinking…" : `Shrink ${summary.shrinkableCount} photos`}
            </button>
            {(shrinking || shrinkLog.done > 0) && (
              <p className="text-sm font-semibold">Shrunk {shrinkLog.done} · saved {mb(shrinkLog.saved)} · skipped {shrinkLog.failed} · remaining {shrinkLog.remaining}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
