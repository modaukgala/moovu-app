"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
export default function Phase6DeletionRequest() {
  const [reason, setReason] = useState(""); const [confirmText, setConfirm] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; reason: string; confirmText: string } | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const { data } = await supabaseClient.auth.getSession(); if (!data.session) throw new Error("Sign in to continue.");
      pending.current ??= { key: crypto.randomUUID(), reason, confirmText };
      const response = await fetch("/api/driver/onboarding/retention", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(pending.current) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      pending.current = null; setMessage(result.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Request unavailable."); } finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-xl p-6"><Link href="/driver/account" className="underline">Driver account</Link><h1 className="mt-4 text-2xl font-bold">Request account deletion</h1><p className="my-4">This records a deletion request for controlled review. Financial history and legal/dispute holds are handled separately. No automatic deletion period has been activated, and this form does not immediately erase your account.</p><form onSubmit={event => void submit(event)}><label className="block">Reason<textarea className="my-2 block w-full rounded border p-3" required minLength={8} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label><label className="block">Type DELETE<input className="my-2 block w-full rounded border p-3" required value={confirmText} onChange={event => setConfirm(event.target.value)} /></label><button className="rounded border p-3" disabled={busy || confirmText !== "DELETE" || reason.trim().length < 8}>Submit / retry request</button></form><p role="status" className="my-4">{message}</p></main>;
}
