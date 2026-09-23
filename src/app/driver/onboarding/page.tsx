"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import Phase6Auth from "@/components/driver/Phase6Auth";
import { Capacitor } from "@capacitor/core";
import { phase6NativeCapture, phase6TransportImage } from "@/lib/drivers/phase6Capture";
import { PHASE6_SECTIONS, PHASE6_REQUIRED, phase6Editable, phase6Evidence, phase6PdpNotice, type Phase6Application, type Phase6Section } from "@/lib/drivers/phase6Policy";

const steps = ["Personal", "Driving Information", "Vehicle Details", "Vehicle Check", "Review & Submit"];
const fields: Record<Phase6Section, string[]> = {
  personal: ["first_name", "last_name", "phone", "id_number", "home_address", "area_name", "emergency_contact_name", "emergency_contact_phone"],
  driving: ["license_number", "license_code", "license_expiry"],
  vehicle: ["vehicle_make", "vehicle_model", "vehicle_color", "vehicle_registration", "vehicle_year", "vehicle_vin", "vehicle_engine_number", "seating_capacity"],
  scanner: ["provider", "condition_notes"],
};
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()); }

export default function DriverOnboarding() {
  const [application, setApplication] = useState<Phase6Application | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [native, setNative] = useState(false);
  const [message, setMessage] = useState("Loading your application…");
  const [reviews, setReviews] = useState<{ action: string; reason: string; source_version: number }[]>([]);
  const pending = useRef<{ key: string; body: Record<string, unknown> } | null>(null);
  const dirty = useRef(false);

  async function request(url: string, options?: RequestInit) {
    const { data } = await supabaseClient.auth.getSession();
    if (!data.session) throw new Error("Sign in to your Driver account to continue.");
    const response = await fetch(url, { ...options, headers: { ...options?.headers, Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "The request could not be completed.");
    return body;
  }
  useEffect(() => {
    setNative(Capacitor.isNativePlatform());
    let mounted = true;
    request("/api/driver/onboarding").then(body => { if (mounted) { setApplication(body.application); setReviews(body.reviews); setMessage(body.application ? "Draft restored from your account." : "Start your Driver onboarding or re-registration."); } }).catch(error => { if (mounted) setMessage(error.message); });
    return () => { mounted = false; };
  }, []);

  async function command(action: string, payload: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    try {
      // Retain the exact operation until acknowledged, including ambiguous network failure.
      if (pending.current && pending.current.body.action !== action) throw new Error("Retry the pending operation before continuing.");
      pending.current ??= { key: crypto.randomUUID(), body: { action, application: application?.id, revision: application?.revision, payload } };
      const body = await request("/api/driver/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pending.current.body, key: pending.current.key }) });
      setApplication(body.application);
      pending.current = null;
      dirty.current = false;
      setMessage(action === "SUBMIT" ? "Submitted for Admin review. Your submitted version is protected." : "Saved to your account.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to continue."); }
    finally { setBusy(false); }
  }
  function save() {
    const draft = application?.draft ?? {};
    const payload = application?.status === "CORRECTION_REQUESTED"
      ? Object.fromEntries(Object.entries(draft).filter(([key]) => application.correction_sections.includes(key))) : draft;
    return command("SAVE", payload);
  }
  useEffect(() => {
    if (!application || !dirty.current || busy || pending.current) return;
    const timer = setTimeout(() => { void save(); }, 1200);
    return () => clearTimeout(timer);
  });
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current || pending.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function change(section: Phase6Section, name: string, value: unknown) {
    if (!application || busy || pending.current) return;
    dirty.current = true;
    setApplication({ ...application, draft: { ...application.draft, [section]: { ...application.draft[section], [name]: value } } });
  }
  async function upload(section: Phase6Section, requirement: string, file: File | undefined, source: string) {
    if (!file || !application || busy || pending.current) return;
    setBusy(true);
    try {
      const form = new FormData();
      const prepared = await phase6TransportImage(file);
      form.set("application", application.id); form.set("section", section); form.set("file", prepared); form.set("source", source);
      const result = await request("/api/driver/onboarding/evidence", { method: "POST", body: form });
      dirty.current = true;
      setApplication({ ...application, draft: { ...application.draft, [section]: { ...application.draft[section], evidence: { ...phase6Evidence(application.draft, section), [requirement]: result.evidence } } } });
      setMessage("Capture checked and stored privately. Saving evidence reference…");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Capture failed."); }
    finally { setBusy(false); }
  }
  const section = PHASE6_SECTIONS[Math.min(step, 3)];
  const editable = application && phase6Editable(application, section);
  return <main className="mx-auto max-w-3xl p-4 sm:p-8">
    <Link href="/driver" className="underline">Driver home</Link>
    <h1 className="mt-4 text-2xl font-bold">Driver onboarding & re-registration</h1>
    <p className="mt-2">Existing Drivers must complete re-registration by 30 November 2026. From 1 December 2026, incomplete re-registration blocks new work. Active trips continue.</p>
    <p role="status" aria-live="polite" className="my-4 rounded border p-3">{message}</p>
    {!application ? <><Link className="mr-4 underline" href="/driver/login">Sign in</Link><button disabled={busy} className="rounded bg-black px-4 py-3 text-white" onClick={() => void command("ENROLL")}>Start / resume</button><Phase6Auth /></> : <>
      <p>Cycle {application.cycle} · Version {application.version} · {label(application.status.toLowerCase())}</p>
      <nav aria-label="Onboarding steps" className="my-4 flex flex-wrap gap-2">{steps.map((name, index) => <button key={name} aria-current={step === index ? "step" : undefined} disabled={busy || dirty.current || !!pending.current} className={`rounded border px-3 py-2 ${step === index ? "bg-black text-white" : ""}`} onClick={() => setStep(index)}>{index + 1}. {name}</button>)}</nav>
      <h2 className="mb-4 text-xl font-semibold">{steps[step]}</h2>
      {step < 4 ? <fieldset disabled={!editable || busy || !!pending.current} className="space-y-4">
        {!editable && <p>This section is protected. Admin may request a scoped correction.</p>}
        {step === 3 && <p>This is a manual vehicle evidence checklist, not AI diagnosis or a roadworthiness certification.</p>}
        {fields[section].map(name => <label key={name} className="block">{label(name)}<input className="mt-1 block w-full rounded border p-3" type={name.endsWith("expiry") ? "date" : ["vehicle_year", "seating_capacity"].includes(name) ? "number" : name.includes("phone") ? "tel" : "text"} value={String(application.draft[section]?.[name] ?? "")} maxLength={name === "condition_notes" ? 2000 : 200} onChange={event => change(section, name, event.target.value)} /></label>)}
        {section === "driving" && <p>{phase6PdpNotice(application.draft)}</p>}
        {section === "vehicle" && <p>Roadworthy uploads are excluded from this checklist. Insurance is optional. Onboarding approval does not create a legal exemption.</p>}
        {[...PHASE6_REQUIRED[section], ...(section === "driving" ? ["pdp"] : section === "vehicle" ? ["insurance"] : [])].map(requirement => <div key={requirement} className="rounded border p-3">
          <p className="font-medium">{label(requirement)} {phase6Evidence(application.draft, section)[requirement] ? "— evidence saved" : ""}</p>
          {native ? <button className="mt-2 rounded border p-3" type="button" onClick={() => void phase6NativeCapture().then(file => upload(section, requirement, file, "camera")).catch(() => setMessage("Capture was cancelled or unavailable. Use the image selector."))}>Take photo</button> : <label className="mt-2 block">Take photo<input className="block max-w-full" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => void upload(section, requirement, event.target.files?.[0], "unknown")} /></label>}
          <label className="mt-2 block">Choose existing image<input className="block max-w-full" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void upload(section, requirement, event.target.files?.[0], "file")} /></label>
          {section === "scanner" && <label className="mt-2 block">Reuse an adequate capture<select className="block w-full rounded border p-2" value={phase6Evidence(application.draft, section)[requirement] ?? ""} onChange={event => change(section, "evidence", { ...phase6Evidence(application.draft, section), [requirement]: event.target.value })}><option value="">Select capture</option>{Object.entries(phase6Evidence(application.draft, section)).filter(([, id]) => id).map(([key, id]) => <option key={key} value={id}>{label(key)}</option>)}</select></label>}
        </div>)}
        <p>Use clear images under 8 MB. A camera/gallery label records capture source; it does not prove authenticity.</p>
      </fieldset> : <div className="space-y-4">
        {PHASE6_SECTIONS.map(key => <section key={key} className="rounded border p-3"><h3 className="font-semibold">{label(key)}</h3><dl>{Object.entries(application.draft[key] ?? {}).filter(([name]) => name !== "evidence").map(([name, value]) => <div key={name}><dt className="inline font-medium">{label(name)}: </dt><dd className="inline break-words">{String(value)}<br /></dd></div>)}</dl><p>{Object.keys(phase6Evidence(application.draft, key)).length} evidence references</p></section>)}
        <p>Submit once for review. Submitted evidence and prior versions cannot be edited. Requested corrections create a new submitted version.</p>
        <button disabled={busy || dirty.current || !["DRAFT", "CORRECTION_REQUESTED"].includes(application.status)} className="rounded bg-black p-3 text-white" onClick={() => void command("SUBMIT")}>Submit for review</button>
      </div>}
      {(dirty.current || pending.current) && <button disabled={busy} className="my-4 rounded border p-3" onClick={() => void save()}>Save / retry pending save</button>}
      <button className="ml-3 rounded border p-3" disabled={busy} onClick={() => { if ((dirty.current || pending.current) && !window.confirm("Reload the saved application and discard unsaved local edits?")) return; void request("/api/driver/onboarding").then(body => { setApplication(body.application); setReviews(body.reviews); pending.current = null; dirty.current = false; setMessage("Latest saved version loaded."); }).catch(error => setMessage(error.message)); }}>Reload saved version</button>
      {reviews.length > 0 && <section className="mt-6"><h2 className="font-semibold">Review history</h2>{reviews.map((review, index) => <p key={index} className="my-2 rounded border p-3">Version {review.source_version} · {label(review.action.toLowerCase())}: {review.reason}</p>)}</section>}
    </>}
  </main>;
}
