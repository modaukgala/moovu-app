"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type Driver = { id: string; first_name: string | null; last_name: string | null; phone: string | null; subscription_status: string | null; subscription_plan: string | null };
type Event = { id: string; action: string; old_status: string | null; new_status: string | null; created_at: string; note: string | null };

export default function AdminSubscriptionsPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [selected, setSelected] = useState<Driver | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const token = useCallback(async () => (await supabaseClient.auth.getSession()).data.session?.access_token ?? "", []);
  const loadDrivers = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Sign in as an Admin to view history.");
      const response = await fetch(`/api/admin/subscriptions/drivers?q=${encodeURIComponent(search)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error("Subscription history is unavailable.");
      setDrivers(body.drivers ?? []);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "History is unavailable."); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void loadDrivers(""); }, [loadDrivers]);
  async function selectDriver(driver: Driver) {
    setSelected(driver); setEvents([]);
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Sign in as an Admin to view history.");
      const response = await fetch(`/api/admin/subscriptions/history?driverId=${encodeURIComponent(driver.id)}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error("Driver history is unavailable.");
      setEvents(body.events ?? []);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Driver history is unavailable."); }
  }
  return <main className="space-y-6 text-slate-950">
    <section className="moovu-card p-5 sm:p-7"><div className="moovu-section-title">MOOVU Admin · Legacy records</div><h1 className="mt-2 text-3xl font-black">Driver subscription history</h1><p className="mt-2 text-sm text-slate-600">Subscriptions are retired. These records are for audit only and do not affect Driver work eligibility.</p><Link href="/admin/subscriptions/paid" className="moovu-btn moovu-btn-secondary mt-4">Past payments</Link></section>
    {message && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">{message}</p>}
    <section className="moovu-card p-5"><form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void loadDrivers(query); }}><label className="sr-only" htmlFor="legacy-driver-search">Search Driver history</label><input id="legacy-driver-search" className="moovu-input max-w-sm" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Driver" /><button className="moovu-btn moovu-btn-secondary" type="submit">Search</button></form>{loading ? <p className="mt-4">Loading historical records…</p> : drivers.length === 0 ? <p className="mt-4">No Drivers found.</p> : <div className="mt-4 grid gap-2 sm:grid-cols-2">{drivers.map(driver => <button key={driver.id} type="button" className="rounded-xl border p-3 text-left hover:bg-slate-50" onClick={() => void selectDriver(driver)}><strong>{`${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || "Unnamed Driver"}</strong><span className="ml-2 text-sm text-slate-500">{driver.phone ?? ""}</span><span className="block text-xs text-slate-500">Past plan: {driver.subscription_plan ?? "none"} · historical status: {driver.subscription_status ?? "none"}</span></button>)}</div>}</section>
    {selected && <section className="moovu-card p-5"><h2 className="text-xl font-bold">Historical events for {`${selected.first_name ?? ""} ${selected.last_name ?? ""}`.trim() || "Driver"}</h2>{events.length === 0 ? <p className="mt-3 text-sm text-slate-600">No historical events found.</p> : <div className="mt-3 space-y-2">{events.map(event => <div key={event.id} className="rounded-xl border p-3 text-sm"><strong>{event.action}</strong> · {event.old_status ?? "—"} → {event.new_status ?? "—"}<span className="block text-slate-500">{new Date(event.created_at).toLocaleString()}</span>{event.note && <p>{event.note}</p>}</div>)}</div>}</section>}
  </main>;
}
