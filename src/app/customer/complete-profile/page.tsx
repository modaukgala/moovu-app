"use client";

import { useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

/** New Google/Apple customers add their name and cellphone once. */
export default function CompleteCustomerProfilePage() {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabaseClient.auth.getUser().then(({ data }) => {
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const full = String(meta.full_name ?? meta.name ?? "").trim();
      const [f, ...rest] = full.split(/\s+/);
      setFirst(String(meta.first_name ?? f ?? ""));
      setLast(String(meta.last_name ?? rest.join(" ") ?? ""));
    });
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const digits = phone.replace(/\D/g, "");
    if (!first.trim() || !last.trim()) { setError("Enter your first and last name."); return; }
    if (!/^(0\d{9}|27\d{9})$/.test(digits)) { setError("Enter a valid South African cellphone number, e.g. 072 123 4567."); return; }
    setBusy(true);
    const { data: auth } = await supabaseClient.auth.getUser();
    const { error: upErr } = await supabaseClient.auth.updateUser({
      data: { first_name: first.trim(), last_name: last.trim(), phone: digits, customer_email: auth.user?.email ?? null },
    });
    if (upErr) { setError(upErr.message); setBusy(false); return; }
    const { data: s } = await supabaseClient.auth.getSession();
    const res = await fetch("/api/customer/me", { headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` }, cache: "no-store" }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!body?.ok) { setError(body?.error ?? "Couldn't finish setting up your account."); setBusy(false); return; }
    window.location.replace("/book");
  };

  return (
    <main className="moovu-app-screen">
      <form className="moovu-app-container max-w-md space-y-4" style={{ padding: 20 }} onSubmit={(e) => void save(e)}>
        <h1 className="text-3xl font-black">Almost done</h1>
        <p className="text-slate-600">Your driver needs your name and cellphone number.</p>
        <label className="block text-sm font-semibold">First name<input className="moovu-input mt-1" value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" /></label>
        <label className="block text-sm font-semibold">Last name<input className="moovu-input mt-1" value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" /></label>
        <label className="block text-sm font-semibold">Cellphone<input className="moovu-input mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="072 123 4567" /></label>
        {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
        <button type="submit" className="moovu-btn moovu-btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Continue"}</button>
      </form>
    </main>
  );
}
