"use client";

import ResetCodeButton from "@/components/admin/ResetCodeButton";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import type { DriverStage } from "@/lib/admin/driverDirectory";

type Summary = {
  id: string; name: string; nameFromRecord: boolean; phone: string | null; email: string | null; system: "new" | "old";
  stage: DriverStage; stageLabel: string; missing: string[]; linked: boolean; online: boolean; busy: boolean;
  lastSeen: string | null; vehicle: string | null; joined: string | null; applicationUpdated: string | null;
  car: { make: string | null; model: string | null; color: string | null; registration: string | null; year: string | null; seats: number | null };
  deletionRequest: { reason: string; at: string } | null;
};

const EMPTY_FORM = { firstName: "", lastName: "", vehicleMake: "", vehicleModel: "", vehicleColor: "", vehicleRegistration: "", vehicleYear: "", seatingCapacity: "" };

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
  const [names, setNames] = useState(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState("");

  const load = useCallback(async () => {
    const json = await api(`/api/admin/drivers/directory?driverId=${encodeURIComponent(driverId)}`);
    if (json?.ok && json.driver) { setD(json.driver); setError(null); } else setError(json?.error ?? "Driver summary unavailable.");
  }, [driverId]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  function startEdit() {
    const parts = (d?.name ?? "").replace(/^No name yet.*$/, "").trim().split(/\s+/);
    setNames({
      firstName: parts[0] ?? "", lastName: parts.slice(1).join(" "),
      vehicleMake: d?.car.make ?? "", vehicleModel: d?.car.model ?? "", vehicleColor: d?.car.color ?? "",
      vehicleRegistration: d?.car.registration ?? "", vehicleYear: d?.car.year ?? "", seatingCapacity: d?.car.seats ? String(d.car.seats) : "",
    });
    setEditing(true);
  }

  async function saveName() {
    setBusy(true); setNotice(null);
    const json = await api("/api/admin/drivers/edit", { method: "POST", body: JSON.stringify({ driverId, ...names }) });
    setBusy(false);
    setNotice(json?.ok ? "Driver details saved." : json?.error ?? "Couldn't save the details.");
    if (json?.ok) { setEditing(false); void load(); }
  }

  async function deleteAccount() {
    setBusy(true); setNotice(null);
    const json = await api("/api/admin/drivers/delete", { method: "POST", body: JSON.stringify({ driverId, confirm: confirmDelete, reason: d?.deletionRequest ? `Driver asked: ${d.deletionRequest.reason}` : "Removed by admin" }) });
    setBusy(false);
    if (json?.ok) { window.location.href = "/admin/drivers"; return; }
    setNotice(json?.error ?? "Couldn't delete the account.");
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
          <button type="button" className="ad-btn" onClick={startEdit}>Edit details</button>
          {d.linked && <ResetCodeButton driverId={driverId} />}
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

      {d.deletionRequest && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900">
          <b>This driver asked to delete their account</b> on {day(d.deletionRequest.at)}: “{d.deletionRequest.reason}”. Use Delete account below to do it.
        </div>
      )}

      {editing && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              ["firstName", "First name"], ["lastName", "Surname"], ["vehicleMake", "Car make (e.g. Toyota)"], ["vehicleModel", "Car model (e.g. Corolla)"],
              ["vehicleColor", "Colour"], ["vehicleRegistration", "Registration number"], ["vehicleYear", "Year (e.g. 2018)"], ["seatingCapacity", "Passenger seats"],
            ] as const).map(([key, label]) => (
              <label key={key} className="text-sm font-semibold">{label}
                <input className="mt-1 w-full rounded-xl border px-3 py-2 font-normal" value={names[key]} onChange={e => setNames(n => ({ ...n, [key]: e.target.value }))} />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className="ad-btn is-primary" disabled={busy} onClick={saveName}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className="ad-btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          <p className="ad-note">ID number, licence and documents can&apos;t be edited here. Send the application back for corrections in Review, and the driver fixes them in the app.</p>
        </div>
      )}

      <details className="rounded-xl bg-red-50 p-3">
        <summary className="cursor-pointer text-sm font-bold text-red-800">Delete this driver&apos;s account</summary>
        <p className="mt-2 text-sm text-red-900">Deletes their login, personal details, ID and licence details and uploaded documents. Completed trips and payments stay in your records without personal details. This can&apos;t be undone. Use Deactivate instead if you only want to stop them driving.</p>
        <input className="mt-2 w-full rounded-xl border px-3 py-2" placeholder="Type DELETE to confirm" value={confirmDelete} onChange={e => setConfirmDelete(e.target.value)} />
        <button type="button" className="ad-btn mt-2 w-full" style={{ color: "#b91c1c" }} disabled={busy || confirmDelete !== "DELETE"} onClick={deleteAccount}>Delete account</button>
      </details>
      {notice && <p className="text-sm font-semibold" role="status">{notice}</p>}
    </section>
  );
}
