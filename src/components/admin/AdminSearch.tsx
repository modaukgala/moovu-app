"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type Results = {
  customers: { id: string; name: string; phone: string | null; email: string | null }[];
  drivers: { id: string; name: string; phone: string | null; status: string | null; online: boolean | null }[];
  trips: { id: string; rider_name: string | null; pickup_address: string | null; dropoff_address: string | null; status: string; created_at: string }[];
};

const day = (iso: string) => new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** One search box for customers, drivers and trips (name, phone or trip ID). */
export default function AdminSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { const t = window.setTimeout(() => setResults(null), 0); return () => window.clearTimeout(t); }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const res = await fetch(`/api/admin/search?q=${encodeURIComponent(term)}`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` }, signal: controller.signal, cache: "no-store",
      }).catch(() => null);
      const json = await res?.json().catch(() => null);
      if (json?.ok) { setResults(json); setOpen(true); }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [q]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!boxRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const total = results ? results.customers.length + results.drivers.length + results.trips.length : 0;

  return (
    <div className="ad-search" ref={boxRef}>
      <Search size={20} aria-hidden="true" />
      <input type="search" value={q} onChange={e => setQ(e.target.value)} onFocus={() => results && setOpen(true)}
        onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
        placeholder="Search customers, drivers or trips — name, phone or trip ID" aria-label="Search admin" />
      {open && results && (
        <div className="ad-search-results" role="listbox">
          {total === 0 && <p className="ad-empty">Nothing found for “{q.trim()}”.</p>}
          {results.customers.length > 0 && <div className="ad-search-group">Customers</div>}
          {results.customers.map(c => (
            <Link key={c.id} href={`/admin/customers/${c.id}`} onClick={() => setOpen(false)}>
              <b>{c.name}</b><span>{[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}</span>
            </Link>
          ))}
          {results.drivers.length > 0 && <div className="ad-search-group">Drivers</div>}
          {results.drivers.map(d => (
            <Link key={d.id} href={`/admin/drivers/${d.id}`} onClick={() => setOpen(false)}>
              <b>{d.name}</b><span>{[d.phone, d.online ? "Online" : "Offline", d.status].filter(Boolean).join(" · ")}</span>
            </Link>
          ))}
          {results.trips.length > 0 && <div className="ad-search-group">Trips</div>}
          {results.trips.map(t => (
            <Link key={t.id} href={`/admin/trips/${t.id}`} onClick={() => setOpen(false)}>
              <b>{t.rider_name || "Customer"} · {t.status}</b>
              <span>{day(t.created_at)} · {t.pickup_address ?? "?"} → {t.dropoff_address ?? "?"}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
