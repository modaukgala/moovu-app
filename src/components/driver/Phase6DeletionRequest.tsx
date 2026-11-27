"use client";
import Link from "next/link";
import { useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

/** Driver deletes their own account. Personal details and the login are removed straight away. */
export default function Phase6DeletionRequest() {
  const [reason, setReason] = useState("");
  const [confirmText, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const { data } = await supabaseClient.auth.getSession();
      if (!data.session) throw new Error("Sign in to continue.");
      const response = await fetch("/api/driver/onboarding/retention", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason, confirmText }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Couldn't delete your account. Please try again.");
      setDone(true);
      setMessage(result.message ?? "Your driver account has been deleted.");
      await supabaseClient.auth.signOut().catch(() => {});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't delete your account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="text-2xl font-black">Account deleted</h1>
        <p>{message} Your personal details and login have been removed. Records of completed trips and payments are kept without your personal details, as the law requires for bookkeeping.</p>
        <Link href="/" className="moovu-btn moovu-btn-primary inline-flex">Done</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <Link href="/driver/account" className="font-bold underline">← Account</Link>
      <h1 className="text-2xl font-black">Delete my driver account</h1>
      <p>This deletes your account <b>straight away</b>: your login, personal details, ID and licence details, and uploaded documents. You won&apos;t be able to receive trips. Completed trip and payment records are kept without your personal details.</p>
      <p>If you have a trip in progress, finish it first.</p>
      <form className="space-y-3" onSubmit={event => void submit(event)}>
        <label className="block font-semibold">Why are you leaving?
          <textarea className="mt-1 block w-full rounded-xl border p-3 font-normal" required minLength={3} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />
        </label>
        <label className="block font-semibold">Type DELETE to confirm
          <input className="mt-1 block w-full rounded-xl border p-3 font-normal" required value={confirmText} onChange={event => setConfirm(event.target.value)} />
        </label>
        <button className="moovu-btn w-full bg-red-600 text-white" disabled={busy || confirmText !== "DELETE" || reason.trim().length < 3}>
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </form>
      {message && <p role="alert" className="font-semibold text-red-700">{message}</p>}
    </main>
  );
}
