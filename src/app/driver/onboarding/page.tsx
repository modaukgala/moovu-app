"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import Phase6Auth from "@/components/driver/Phase6Auth";
import { Capacitor } from "@capacitor/core";
import { phase6NativeCapture, phase6TransportImage } from "@/lib/drivers/phase6Capture";
import { PHASE6_SECTIONS, PHASE6_REQUIRED, phase6Editable, phase6Evidence, phase6MissingRequirements, phase6PdpNotice, type Phase6Application, type Phase6Section } from "@/lib/drivers/phase6Policy";
import { mergeMissingDriverDetails, reusableLegacyDocument } from "@/lib/drivers/onboardingTransition";
import type { Phase6Draft } from "@/lib/drivers/phase6Policy";

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
  const [existingDetails, setExistingDetails] = useState<Phase6Draft>({});
  const [signedIn, setSignedIn] = useState(false);
  const [documents, setDocuments] = useState<{ id: string; file_path: string; doc_type: string; status?: string; review_status?: string; expires_on?: string }[]>([]);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [native, setNative] = useState(false);
  const [message, setMessage] = useState("Loading your application…");
  const [reviews, setReviews] = useState<{ action: string; reason: string; source_version: number }[]>([]);
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(null);
  const previewUrl = useRef<string | null>(null);
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
    void supabaseClient.auth.getSession().then(({ data }) => { if (mounted) setSignedIn(!!data.session); });
    void request("/api/driver/documents").then(body => { if (mounted) setDocuments(body.documents ?? []); }).catch(() => {});
    request("/api/driver/onboarding").then(body => { if (mounted) { setApplication(body.application); setReviews(body.reviews ?? []); setExistingDetails(body.existingDetails ?? {}); setMessage(body.application ? "Draft restored from your account." : "Start your Driver onboarding or re-registration."); } }).catch(error => { if (mounted) setMessage(error.message); });
    return () => { mounted = false; if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); };
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
  async function showEvidence(requirement: string, evidenceId: string) {
    if (!application) return;
    try {
      const { data } = await supabaseClient.auth.getSession();
      if (!data.session) throw new Error("Sign in to view evidence.");
      const response = await fetch(`/api/driver/onboarding/evidence?application=${encodeURIComponent(application.id)}&evidence=${encodeURIComponent(evidenceId)}`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store",
      });
      if (!response.ok) throw new Error("Evidence preview is unavailable. Please retry.");
      const url = URL.createObjectURL(await response.blob());
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = url;
      setPreview({ title: label(requirement), url });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Evidence preview is unavailable."); }
  }
  const section = PHASE6_SECTIONS[Math.min(step, 3)];
  const editable = application && phase6Editable(application, section);
  const missing = application ? phase6MissingRequirements(application.draft) : null;
  const missingCount = missing ? Object.values(missing).reduce((sum, items) => sum + items.length, 0) : 0;
  const statusTitle: Record<string, string> = { DRAFT: "Draft in progress", SUBMITTED: "Submitted for review", RESUBMITTED: "Resubmitted for review", UNDER_REVIEW: "Under Admin review", CORRECTION_REQUESTED: "Changes requested", APPROVED: "Application approved", REJECTED: "Application rejected" };
  return <main className="moovu-page min-h-screen bg-[#f3f7fb] text-slate-900"><div className="mx-auto max-w-4xl pb-24">
    <div className="mb-4 flex items-center justify-between gap-3"><Link href="/driver" className="moovu-btn moovu-btn-secondary">← Driver home</Link><span className="text-xs font-bold uppercase tracking-widest text-blue-700">MOOVU Driver</span></div>
    <header className="moovu-hero-panel p-6 sm:p-8"><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-100">Apply to drive</p><h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Your Driver application</h1><p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-blue-50">Start, save and return when you are ready. Existing Drivers keep the same account, trips and work access during re-registration.</p></header>
    <p role="status" aria-live="polite" className="my-4 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm font-semibold text-blue-900">{busy ? "Working on your application… " : ""}{message}</p>
    {!application ? <>{signedIn ? <button disabled={busy} className="rounded bg-black px-4 py-3 text-white" onClick={() => void command("ENROLL")}>Start / resume</button> : <><Link className="mr-4 underline" href="/driver/login">Existing Driver — Sign In</Link><Phase6Auth /></>}</> : <>
      {application.status === "DRAFT" && Object.values(existingDetails).some(section => Object.keys(section ?? {}).length) && <button className="my-3 rounded border p-3" disabled={busy || dirty.current || !!pending.current} onClick={() => void command("SAVE", mergeMissingDriverDetails(application.draft, existingDetails))}>Reuse existing profile and vehicle details</button>}
      <section className="moovu-card my-4 p-4 sm:p-5"><p className="text-xs font-black uppercase tracking-widest text-blue-700">Application status</p><p className="mt-1 text-lg font-bold">{statusTitle[application.status] ?? label(application.status.toLowerCase())}</p><p className="mt-1 text-sm text-slate-600">Cycle {application.cycle} · Version {application.version}{application.status === "CORRECTION_REQUESTED" ? ` · Update ${application.correction_sections.map(label).join(", ")}` : ""}</p></section>
      <nav aria-label="Onboarding steps" className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-5">{steps.map((name, index) => <button key={name} type="button" aria-current={step === index ? "step" : undefined} disabled={busy || dirty.current || !!pending.current} className={`min-h-12 rounded-2xl border px-3 py-2 text-left text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${step === index ? "border-blue-700 bg-blue-700 text-white" : "border-slate-200 bg-white text-slate-700"}`} onClick={() => setStep(index)}><span className="block text-xs opacity-75">{index + 1} of 5</span>{name}</button>)}</nav>
      <div className="moovu-card p-4 sm:p-6"><p className="text-xs font-bold uppercase tracking-widest text-blue-700">Step {step + 1} of {steps.length}</p><h2 className="mb-4 mt-1 text-2xl font-bold">{steps[step]}</h2>
      {step < 4 ? <fieldset disabled={!editable || busy || !!pending.current} className="space-y-4">
        {!editable && <p>This section is protected. Admin may request a scoped correction.</p>}
        {step === 3 && <p>This is a manual vehicle evidence checklist, not AI diagnosis or a roadworthiness certification.</p>}
        {fields[section].map(name => <label key={name} className="block text-sm font-semibold text-slate-800">{label(name)}{missing?.[section].includes(name) && <span className="ml-2 text-xs font-medium text-amber-700">Required</span>}<input className="moovu-input mt-2 block w-full" type={name.endsWith("expiry") ? "date" : ["vehicle_year", "seating_capacity"].includes(name) ? "number" : name.includes("phone") ? "tel" : "text"} autoComplete={name === "first_name" ? "given-name" : name === "last_name" ? "family-name" : name === "phone" ? "tel" : name === "home_address" ? "street-address" : "off"} inputMode={name === "id_number" || name === "vehicle_year" || name === "seating_capacity" ? "numeric" : undefined} value={String(application.draft[section]?.[name] ?? "")} maxLength={name === "condition_notes" ? 2000 : 200} onChange={event => change(section, name, event.target.value)} /></label>)}
        {section === "driving" && <p>{phase6PdpNotice(application.draft)}</p>}
        {section === "vehicle" && <p>Roadworthy uploads are excluded from this checklist. Insurance is optional. Onboarding approval does not create a legal exemption.</p>}
        {[...PHASE6_REQUIRED[section], ...(section === "driving" ? ["pdp"] : section === "vehicle" ? ["insurance"] : [])].map(requirement => <div key={requirement} className="rounded border p-3">
          <p className="font-medium">{label(requirement)} <span className={phase6Evidence(application.draft, section)[requirement] ? "text-emerald-700" : "text-amber-700"}>{phase6Evidence(application.draft, section)[requirement] ? "· Uploaded" : (PHASE6_REQUIRED[section] as readonly string[]).includes(requirement) ? "· Required" : "· Optional"}</span></p>
          {documents.filter(document => reusableLegacyDocument(document) && document.doc_type === requirement).map(document => <button key={document.id} className="my-2 rounded border p-3" type="button" onClick={() => {
            void request("/api/driver/documents/signed-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: document.file_path }) }).then(async body => {
              const url = new URL(body.url);
              if (url.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin) throw new Error("Existing evidence location is invalid.");
              const response = await fetch(url.href);
              if (!response.ok) throw new Error("Existing evidence is unavailable.");
              const blob = await response.blob();
              await upload(section, requirement, new File([blob], "existing-evidence", { type: blob.type }), "file");
            }).catch(() => setMessage("Existing evidence cannot be reused safely. Choose a clear capture or contact support."));
          }}>Reuse approved existing {label(requirement)}</button>)}
          {native ? <button className="mt-2 rounded border p-3" type="button" onClick={() => void phase6NativeCapture().then(file => upload(section, requirement, file, "camera")).catch(() => setMessage("Capture was cancelled or unavailable. Use the image selector."))}>Take photo</button> : <label className="mt-2 block">Take photo<input className="block max-w-full" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => void upload(section, requirement, event.target.files?.[0], "unknown")} /></label>}
          <label className="mt-2 block">Choose existing image<input className="block max-w-full" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void upload(section, requirement, event.target.files?.[0], "file")} /></label>
          {phase6Evidence(application.draft, section)[requirement] && <div className="mt-3 flex flex-wrap gap-4"><button type="button" className="text-sm font-bold text-blue-700 underline" onClick={() => void showEvidence(requirement, phase6Evidence(application.draft, section)[requirement])}>Preview image</button><button type="button" className="text-sm font-bold text-red-700 underline" onClick={() => { const next = { ...phase6Evidence(application.draft, section) }; delete next[requirement]; change(section, "evidence", next); }}>Remove from application</button></div>}
          {section === "scanner" && <label className="mt-2 block">Reuse an adequate capture<select className="block w-full rounded border p-2" value={phase6Evidence(application.draft, section)[requirement] ?? ""} onChange={event => change(section, "evidence", { ...phase6Evidence(application.draft, section), [requirement]: event.target.value })}><option value="">Select capture</option>{Object.entries(phase6Evidence(application.draft, section)).filter(([, id]) => id).map(([key, id]) => <option key={key} value={id}>{label(key)}</option>)}</select></label>}
        </div>)}
        <p>Use clear images under 8 MB. A camera/gallery label records capture source; it does not prove authenticity.</p>
      </fieldset> : <div className="space-y-4">
        <p className="rounded-2xl bg-blue-50 p-4 text-sm font-semibold text-blue-900">{missingCount === 0 ? "All listed details and evidence are present. Submission still performs final server checks." : `${missingCount} required item${missingCount === 1 ? "" : "s"} still need your attention before submission.`}</p>
        {PHASE6_SECTIONS.map(key => <section key={key} className="rounded border p-3"><h3 className="font-semibold">{label(key)}</h3><dl>{Object.entries(application.draft[key] ?? {}).filter(([name]) => name !== "evidence").map(([name, value]) => <div key={name}><dt className="inline font-medium">{label(name)}: </dt><dd className="inline break-words">{String(value)}<br /></dd></div>)}</dl><p>{Object.keys(phase6Evidence(application.draft, key)).length} evidence references</p></section>)}
        {missing && PHASE6_SECTIONS.map(key => missing[key].length > 0 && <div key={key} className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="font-bold text-amber-900">{label(key)} needs attention</p><p className="mt-1 text-sm text-amber-900">{missing[key].map(label).join(", ")}</p><button type="button" className="mt-2 font-bold text-blue-700 underline" onClick={() => setStep(PHASE6_SECTIONS.indexOf(key))}>Go to {label(key)}</button></div>)}
        <p>Submit once for review. Submitted evidence and prior versions cannot be edited. Requested corrections create a new submitted version.</p>
        <button disabled={busy || dirty.current || missingCount > 0 || !["DRAFT", "CORRECTION_REQUESTED"].includes(application.status)} className="moovu-btn moovu-btn-primary w-full sm:w-auto" onClick={() => void command("SUBMIT")}>Submit application</button>
      </div>}
      {step < 4 && <div className="mt-6 flex flex-wrap gap-3"><button type="button" className="moovu-btn moovu-btn-secondary" disabled={busy || step === 0} onClick={() => setStep(step - 1)}>Back</button><button type="button" className="moovu-btn moovu-btn-primary" disabled={busy || dirty.current || !!pending.current} onClick={() => setStep(step + 1)}>Continue</button><Link href="/driver" className="moovu-btn moovu-btn-secondary">Continue later</Link></div>}</div>
      {(dirty.current || pending.current) && <button disabled={busy} className="my-4 rounded border p-3" onClick={() => void save()}>Save / retry pending save</button>}
      <button className="ml-3 rounded border p-3" disabled={busy} onClick={() => { if ((dirty.current || pending.current) && !window.confirm("Reload the saved application and discard unsaved local edits?")) return; void request("/api/driver/onboarding").then(body => { setApplication(body.application); setReviews(body.reviews); pending.current = null; dirty.current = false; setMessage("Latest saved version loaded."); }).catch(error => setMessage(error.message)); }}>Reload saved version</button>
      {reviews.length > 0 && <section className="mt-6"><h2 className="font-semibold">Review history</h2>{reviews.map((review, index) => <p key={index} className="my-2 rounded border p-3">Version {review.source_version} · {label(review.action.toLowerCase())}: {review.reason}</p>)}</section>}
    </>}
    {preview && <div role="dialog" aria-modal="true" aria-label={`${preview.title} preview`} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"><div className="max-h-[90dvh] w-full max-w-2xl overflow-auto rounded-3xl bg-white p-4"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-bold">{preview.title}</h2><button type="button" className="moovu-btn moovu-btn-secondary" onClick={() => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; setPreview(null); }}>Close</button></div><Image src={preview.url} alt={`${preview.title} evidence`} width={900} height={900} unoptimized className="h-auto max-h-[70dvh] w-full rounded-xl object-contain" /></div></div>}
  </div></main>;
}
