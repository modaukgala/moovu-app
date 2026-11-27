"use client";

import { useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { adminDriverName } from "@/lib/admin/identity";

type DriverOption = {
  id: string; first_name: string | null; last_name: string | null; phone: string | null;
  status: string; online: boolean | null; busy: boolean | null;
};

async function authed(url: string, init?: RequestInit) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const res = await fetch(url, {
    ...init, cache: "no-store",
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  }).catch(() => null);
  return res?.json().catch(() => null) ?? null;
}

/**
 * Two small actions for a trip with no driver: "Assign driver" (send this trip to one chosen driver)
 * and "Re-offer to drivers" (offer it again to every available driver). Uses the existing dispatch APIs.
 */
export default function TripDispatchActions({ tripId, onDone }: { tripId: string; onDone?: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [drivers, setDrivers] = useState<DriverOption[] | null>(null);
  const [filter, setFilter] = useState("");

  async function reoffer() {
    setBusy(true);
    const json = await authed("/api/admin/trips/auto-assign", { method: "POST", body: JSON.stringify({ tripId }) });
    setBusy(false);
    onDone?.(json?.ok ? "Trip re-offered to available drivers." : json?.error ?? "Couldn't re-offer the trip.");
  }

  async function openPicker() {
    setPicking(true);
    if (drivers) return;
    const json = await authed("/api/admin/drivers/options");
    const rows = ((json?.drivers ?? []) as DriverOption[]).filter(d => ["approved", "active"].includes(d.status));
    rows.sort((a, b) => Number(Boolean(b.online) && !b.busy) - Number(Boolean(a.online) && !a.busy));
    setDrivers(rows);
  }

  async function assign(driver: DriverOption) {
    setBusy(true);
    const json = await authed("/api/admin/trips/assign", { method: "POST", body: JSON.stringify({ tripId, driverId: driver.id }) });
    setBusy(false);
    setPicking(false);
    onDone?.(json?.ok ? `Trip sent to ${adminDriverName(driver)}. They have a short time to accept.` : json?.error ?? "Couldn't assign the driver.");
  }

  const shown = (drivers ?? []).filter(d => {
    const term = filter.trim().toLowerCase();
    return !term || `${adminDriverName(d)} ${d.phone ?? ""}`.toLowerCase().includes(term);
  });

  return (
    <>
      <button type="button" className="ad-btn" disabled={busy} onClick={openPicker}>Assign driver</button>
      <button type="button" className="ad-btn is-primary" disabled={busy} onClick={reoffer}>{busy ? "Working…" : "Re-offer to drivers"}</button>
      {picking && (
        <div className="ad-sheet-layer" role="dialog" aria-modal="true" aria-label="Choose a driver" onClick={() => setPicking(false)}>
          <div className="ad-sheet" onClick={e => e.stopPropagation()}>
            <div className="ad-card-head"><h2>Choose a driver</h2><button type="button" className="ad-btn" onClick={() => setPicking(false)}>Close</button></div>
            <p className="ad-note">The driver gets this trip as an offer and has a short time to accept. Online drivers are listed first.</p>
            <input className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5" placeholder="Search name or phone"
              value={filter} onChange={e => setFilter(e.target.value)} />
            <div className="ad-rows mt-3">
              {!drivers && <p className="ad-empty">Loading drivers…</p>}
              {drivers && shown.length === 0 && <p className="ad-empty">No matching drivers.</p>}
              {shown.map(d => {
                const free = Boolean(d.online) && !d.busy;
                return (
                  <button key={d.id} type="button" className="ad-row text-left" disabled={busy} onClick={() => assign(d)}>
                    <span><span className="ad-row-title">{adminDriverName(d)}</span><span className="ad-row-sub block">{d.phone ?? "No phone"}</span></span>
                    <span className={`ad-badge ${free ? "is-done" : d.online ? "is-waiting" : ""}`}>{free ? "Online · free" : d.online ? "On a trip" : "Offline"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
