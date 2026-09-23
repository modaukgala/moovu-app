"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { PHASE6_SECTIONS, type Phase6Application } from "@/lib/drivers/phase6Policy";

type Review = { id: string; action: string; source_version: number; reason: string; created_at: string };
type Detail = { application: Phase6Application; versions: { version: number; snapshot: unknown; submitted_at: string }[]; reviews: Review[]; uploads: { id: string; section: string; state: string; source: string }[] };
export default function OnboardingReview() {
  const [queue, setQueue] = useState<Phase6Application[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reason, setReason] = useState("");
  const [sections, setSections] = useState<string[]>([]);
  const [message, setMessage] = useState("Loading review queue…");
  const [busy, setBusy] = useState(false);
  const pending = useRef<Record<string, unknown> | null>(null);
  const request = useCallback(async (url: string, options?: RequestInit) => {
    const { data } = await supabaseClient.auth.getSession();
    if (!data.session) throw new Error("Reviewer sign-in required.");
    const response = await fetch(url, { ...options, headers: { ...options?.headers, Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Review unavailable.");
    return body;
  }, []);
  const load = useCallback(async (id?: string) => {
    setBusy(true);
    try {
      const body = await request(`/api/admin/onboarding${id ? `?id=${encodeURIComponent(id)}` : ""}`);
      if (id) setDetail(body); else setQueue(body.applications);
      setMessage("Review current immutable version and evidence before deciding.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Review unavailable."); }
    finally { setBusy(false); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  async function decision(action: string) {
    if (!detail || busy) return;
    setBusy(true);
    try {
      if (pending.current && pending.current.action !== action) throw new Error("Retry the pending decision before choosing another.");
      pending.current ??= { key: crypto.randomUUID(), action, application: detail.application.id, revision: detail.application.revision, reason, sections };
      const body = await request("/api/admin/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current) });
      pending.current = null;
      const refreshed = await request(`/api/admin/onboarding?id=${encodeURIComponent(body.application.id)}`);
      setDetail(refreshed); setReason(""); setSections([]);
      setMessage("Decision recorded atomically with actor, reason and source version. Review history refreshed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Decision unavailable."); }
    finally { setBusy(false); }
  }
  async function preview(id: string) {
    if (!detail) return;
    try {
      const { data } = await supabaseClient.auth.getSession();
      if (!data.session) throw new Error("Reviewer sign-in required.");
      const response = await fetch(`/api/driver/onboarding/evidence?review=true&application=${detail.application.id}&evidence=${id}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("Evidence unavailable.");
      const url = URL.createObjectURL(await response.blob());
      const tab = window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      if (!tab) setMessage("Your browser may have blocked the evidence preview window.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Evidence unavailable."); }
  }
  const status = detail?.application.status;
  return <main className="mx-auto max-w-5xl p-4 sm:p-8">
    <h1 className="text-2xl font-bold">Driver onboarding review</h1>
    <p role="status" className="my-4 rounded border p-3">{message}</p>
    <button className="rounded border p-2" disabled={busy || !!pending.current} onClick={() => void load(detail?.application.id)}>Refresh</button>
    <div className="my-4 flex flex-wrap gap-2">{queue.map(item => <button className="rounded border p-3 text-left" key={item.id} disabled={busy || !!pending.current} onClick={() => void load(item.id)}>Cycle {item.cycle} · {item.status}<br /><span className="text-xs">{item.id}</span></button>)}</div>
    {detail && <>
      <h2 className="text-xl font-semibold">Cycle {detail.application.cycle} · Version {detail.application.version} · {status}</h2>
      <p className="my-2">Submitted data cannot be edited. Request a scoped correction, or record a reasoned decision against this version.</p>
      {detail.versions.map(version => <details className="my-3 rounded border p-3" key={version.version} open={version.version === detail.application.version}><summary>Immutable version {version.version} · {new Date(version.submitted_at).toLocaleString()}</summary><pre className="overflow-auto whitespace-pre-wrap break-words text-sm">{JSON.stringify(version.snapshot, null, 2)}</pre></details>)}
      <section><h3 className="font-semibold">Private evidence</h3><p>Capture source is metadata, not authenticity proof. Vehicle Check is manual evidence, not AI diagnosis.</p><div className="my-3 flex flex-wrap gap-2">{detail.uploads.filter(upload => upload.state === "VALIDATED").map(upload => <button className="rounded border p-2" key={upload.id} onClick={() => void preview(upload.id)}>{upload.section} · {upload.source} · View capture</button>)}</div></section>
      <fieldset disabled={busy || !!pending.current} className="my-4 space-y-3"><label className="block">Decision reason (8–2,000 characters)<textarea className="block w-full rounded border p-3" value={reason} minLength={8} maxLength={2000} onChange={event => setReason(event.target.value)} /></label><div>Correction sections:{PHASE6_SECTIONS.map(section => <label className="ml-3 inline-block" key={section}><input type="checkbox" checked={sections.includes(section)} onChange={event => setSections(event.target.checked ? [...sections, section] : sections.filter(item => item !== section))} /> {section}</label>)}</div></fieldset>
      <div className="flex flex-wrap gap-2">{(status === "SUBMITTED" || status === "RESUBMITTED" ? ["UNDER_REVIEW"] : status === "UNDER_REVIEW" ? ["APPROVED", "REJECTED", "CORRECTION_REQUESTED"] : status === "REJECTED" ? ["REAPPLICATION_AUTHORIZED"] : status === "APPROVED" ? ["REINSPECTION_AUTHORIZED"] : []).map(action => <button className="rounded bg-black p-3 text-white" key={action} disabled={busy || reason.trim().length < 8 || action === "CORRECTION_REQUESTED" && !sections.length} onClick={() => void decision(action)}>{action.replaceAll("_", " ")}{pending.current?.action === action ? " — Retry" : ""}</button>)}</div>
      <section className="mt-5"><h3 className="font-semibold">Review history</h3>{detail.reviews.map(review => <p className="my-2 rounded border p-3" key={review.id}>Version {review.source_version} · {review.action} · {new Date(review.created_at).toLocaleString()}<br />{review.reason}</p>)}</section>
    </>}
  </main>;
}
