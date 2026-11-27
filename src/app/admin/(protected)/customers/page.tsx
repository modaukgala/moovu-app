"use client";

import ResetCodeButton from "@/components/admin/ResetCodeButton";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type Customer = {
  id: string; account_source: "customer_profile" | "auth_only"; first_name: string | null; last_name: string | null;
  phone: string | null; email: string | null; status: string; created_at: string | null;
  total_trips: number; completed_trips: number; cancelled_trips: number; total_spend: number; last_activity: string | null;
};

type DupCustomer = {
  id: string; first_name: string | null; last_name: string | null; phone: string | null; email: string | null;
  created_at: string | null; status: string | null; trips: { total: number; completed: number; last: string | null };
};

const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "–";
const name = (c: { first_name: string | null; last_name: string | null }) => [c.first_name, c.last_name].filter(Boolean).join(" ") || "No name";

async function api(url: string, init?: RequestInit) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const res = await fetch(url, {
    ...init, cache: "no-store",
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  }).catch(() => null);
  return res?.json().catch(() => null) ?? null;
}

function EditSheet({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: (msg: string) => void }) {
  const [form, setForm] = useState({ firstName: customer.first_name ?? "", lastName: customer.last_name ?? "", phone: customer.phone ?? "", email: customer.email ?? "", status: customer.status === "blocked" ? "blocked" : "active" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState("");

  async function save() {
    setBusy(true); setError(null);
    const json = await api(`/api/admin/customers/${customer.id}`, { method: "PATCH", body: JSON.stringify(form) });
    setBusy(false);
    if (!json?.ok) { setError(json?.error ?? "Couldn't save."); return; }
    onSaved("Customer details saved.");
  }

  async function remove() {
    setBusy(true); setError(null);
    const json = await api(`/api/admin/customers/${customer.id}`, { method: "DELETE", body: JSON.stringify({ confirm: confirmDelete }) });
    setBusy(false);
    if (!json?.ok) { setError(json?.error ?? "Couldn't remove the customer."); return; }
    onSaved(`${name(customer)} was removed. Their past trips are kept without personal details.`);
  }

  const input = (key: keyof typeof form, label: string, props?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="block text-sm font-semibold">{label}
      <input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal" value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} {...props} />
    </label>
  );

  return (
    <div className="ad-sheet-layer" role="dialog" aria-modal="true" aria-label="Edit customer" onClick={onClose}>
      <div className="ad-sheet space-y-3" onClick={e => e.stopPropagation()}>
        <div className="ad-card-head"><h2>Edit {name(customer)}</h2><button type="button" className="ad-btn" onClick={onClose}>Close</button></div>
        <div className="grid gap-3 sm:grid-cols-2">{input("firstName", "First name")}{input("lastName", "Surname")}</div>
        {input("phone", "Phone", { inputMode: "tel" })}
        {input("email", "Email (optional)", { type: "email" })}
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.status === "blocked"} onChange={e => setForm(f => ({ ...f, status: e.target.checked ? "blocked" : "active" }))} />
          Block this customer from booking
        </label>
        {error && <p className="text-sm font-semibold text-red-700" role="alert">{error}</p>}
        <button type="button" className="ad-btn is-primary w-full" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
        <details className="rounded-xl bg-red-50 p-3">
          <summary className="cursor-pointer text-sm font-bold text-red-800">Remove this customer</summary>
          <p className="mt-2 text-sm text-red-900">Their login and personal details are deleted. Past trips stay in your records without their name or number. This can&apos;t be undone.</p>
          <input className="mt-2 w-full rounded-xl border px-3 py-2" placeholder="Type DELETE to confirm" value={confirmDelete} onChange={e => setConfirmDelete(e.target.value)} />
          <button type="button" className="ad-btn mt-2 w-full" style={{ color: "#b91c1c" }} disabled={busy || confirmDelete !== "DELETE"} onClick={remove}>Remove customer</button>
        </details>
      </div>
    </div>
  );
}

function Duplicates({ onChanged }: { onChanged: (msg: string) => void }) {
  const [groups, setGroups] = useState<{ name: string; customers: DupCustomer[] }[] | null>(null);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const json = await api("/api/admin/customers/duplicates");
    if (json?.ok) setGroups(json.groups); else setError(json?.error ?? "Couldn't check for duplicates.");
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  async function merge(group: string, keepId: string, removeId: string, removeName: string) {
    if (!window.confirm(`Move all of ${removeName}'s trips into the kept account, then remove this duplicate login? This can't be undone.`)) return;
    setBusy(removeId); setError(null);
    const json = await api("/api/admin/customers/merge", { method: "POST", body: JSON.stringify({ keepId, removeId }) });
    setBusy(null);
    if (!json?.ok) { setError(json?.error ?? "Couldn't merge."); return; }
    onChanged(`Merged. ${json.movedTrips} trip${json.movedTrips === 1 ? "" : "s"} moved.`);
    void load();
    void group;
  }

  if (error && !groups) return <p className="ad-empty">{error}</p>;
  if (!groups) return <p className="ad-empty">Checking for duplicates…</p>;
  if (groups.length === 0) return <p className="ad-empty">No possible duplicates found.</p>;

  return (
    <div className="space-y-3">
      <p className="ad-note">These accounts share the same first name and surname, but have different phone numbers. Many are different people with common names, so check the phone numbers and trips before merging. Pick the account to <b>keep</b>, then merge the others into it.</p>
      {error && <p className="text-sm font-semibold text-red-700" role="alert">{error}</p>}
      {groups.map(group => {
        const keepId = keep[group.name] ?? group.customers[0].id;
        return (
          <section key={group.name} className="ad-card">
            <div className="ad-card-head"><h2>{group.name}</h2><span className="ad-badge is-waiting">{group.customers.length} accounts</span></div>
            <div className="ad-rows">
              {group.customers.map(c => (
                <div key={c.id} className="ad-row">
                  <label className="flex min-w-0 items-start gap-3">
                    <input type="radio" className="mt-1" name={`keep-${group.name}`} checked={keepId === c.id} onChange={() => setKeep(k => ({ ...k, [group.name]: c.id }))} />
                    <span className="min-w-0">
                      <span className="ad-row-title">{c.phone ?? "No phone"}{keepId === c.id ? " · keep" : ""}</span>
                      <span className="ad-row-sub block">{c.email ?? "No email"} · joined {day(c.created_at)} · {c.trips.total} trips ({c.trips.completed} completed){c.trips.last ? ` · last ${day(c.trips.last)}` : ""}</span>
                    </span>
                  </label>
                  <div className="ad-row-actions">
                    <Link href={`/admin/customers/${c.id}`} className="ad-btn">Open</Link>
                    {keepId !== c.id && (
                      <button type="button" className="ad-btn" disabled={busy !== null} onClick={() => merge(group.name, keepId, c.id, c.phone ?? name(c))}>
                        {busy === c.id ? "Merging…" : "Merge into kept"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function AdminCustomersPage() {
  const [tab, setTab] = useState<"all" | "duplicates">("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ customers: Customer[]; total: number | null; total_lower_bound: number | null; total_pages: number } | null>(null);
  const [dupCount, setDupCount] = useState<number | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCustomers = useCallback(async (term: string, pageNo: number) => {
    const params = new URLSearchParams({ page: String(pageNo), pageSize: "25" });
    if (term.trim()) params.set("q", term.trim());
    const json = await api(`/api/admin/customers?${params}`);
    if (json?.ok) { setData(json); setError(null); } else setError(json?.error ?? "Couldn't load customers.");
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void loadCustomers(q, page), q ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [q, page, loadCustomers]);

  useEffect(() => {
    void api("/api/admin/customers/duplicates").then(json => { if (json?.ok) setDupCount(json.groups.length); });
  }, []);

  const total = data?.total ?? data?.total_lower_bound ?? null;

  return (
    <div className="ad-page">
      <header className="ad-head">
        <h1>Customers</h1>
        <p>{total === null ? "Loading…" : `${total.toLocaleString("en-ZA")} registered customer${total === 1 ? "" : "s"}${q ? " match your search" : ""}.`}</p>
      </header>

      <div className="ad-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "all"} className={tab === "all" ? "is-on" : ""} onClick={() => setTab("all")}>All customers</button>
        <button type="button" role="tab" aria-selected={tab === "duplicates"} className={tab === "duplicates" ? "is-on" : ""} onClick={() => setTab("duplicates")}>
          Possible duplicates{dupCount ? ` (${dupCount})` : ""}
        </button>
      </div>

      {notice && <p className="ad-card text-sm font-semibold" role="status">{notice}</p>}

      {tab === "duplicates" ? <Duplicates onChanged={msg => { setNotice(msg); void loadCustomers(q, page); }} /> : (
        <section className="ad-card space-y-3">
          <input type="search" className="w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="Search name, phone or email"
            value={q} onChange={e => { setQ(e.target.value); setPage(1); }} aria-label="Search customers" />
          {error && <p className="ad-empty">{error}</p>}
          {!data && !error && <p className="ad-empty">Loading customers…</p>}
          {data && data.customers.length === 0 && <p className="ad-empty">No customers found.</p>}
          <div className="ad-rows">
            {data?.customers.map(c => (
              <article key={c.id} className="ad-row">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="ad-row-title">{name(c)}</span>
                    {c.status === "blocked" && <span className="ad-badge is-off">Blocked</span>}
                    {c.account_source === "auth_only" && <span className="ad-badge is-waiting">Sign-up not finished</span>}
                  </div>
                  <div className="ad-row-sub">{[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}</div>
                  <div className="ad-row-sub">Joined {day(c.created_at)} · {c.completed_trips} completed trip{c.completed_trips === 1 ? "" : "s"}{c.cancelled_trips ? ` · ${c.cancelled_trips} cancelled` : ""} · spent R{Number(c.total_spend ?? 0).toFixed(0)}</div>
                </div>
                <div className="ad-row-actions">
                  <Link href={`/admin/customers/${c.id}`} className="ad-btn">Open</Link>
                  {c.account_source === "customer_profile" && <button type="button" className="ad-btn" onClick={() => setEditing(c)}>Edit</button>}
                  {c.account_source === "customer_profile" && <ResetCodeButton customerId={c.id} />}
                </div>
              </article>
            ))}
          </div>
          {data && data.total_pages > 1 && (
            <nav className="flex items-center justify-between gap-3" aria-label="Customer pages">
              <button type="button" className="ad-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
              <span className="ad-note">Page {page} of {data.total_pages}</span>
              <button type="button" className="ad-btn" disabled={page >= data.total_pages} onClick={() => setPage(p => p + 1)}>Next</button>
            </nav>
          )}
        </section>
      )}

      {editing && <EditSheet customer={editing} onClose={() => setEditing(null)} onSaved={msg => { setEditing(null); setNotice(msg); void loadCustomers(q, page); }} />}
    </div>
  );
}
