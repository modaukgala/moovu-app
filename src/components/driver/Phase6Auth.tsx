"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabase/client";
import { validNewPassword, PASSWORD_GUIDANCE } from "@/lib/auth/passwordPolicy";

export default function Phase6Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function signUp(event: React.FormEvent) {
    event.preventDefault();
    if (!validNewPassword(password)) { setMessage(PASSWORD_GUIDANCE); return; }
    setBusy(true);
    try {
      const current = await supabaseClient.auth.getSession();
      if (current.data.session) { setMessage("Already signed in. Use Start / resume instead of creating another account."); return; }
      const { data, error } = await supabaseClient.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: new URL("/driver/onboarding", window.location.origin).href } });
      setPassword("");
      if (error || data.user?.identities?.length === 0) setMessage("Unable to create an account. Existing Driver? Sign in to your current account instead.");
      else if (data.session) window.location.replace("/driver/onboarding");
      else setMessage("Confirm your email, then sign in and resume onboarding. An Auth account alone does not grant Driver access.");
    } catch { setMessage("Account creation is unavailable. Try again or contact support."); }
    finally { setBusy(false); }
  }
  return <section className="moovu-card my-6 p-5 sm:p-7">
    <p className="moovu-section-title">New to MOOVU Driver</p><h2 className="mt-2 text-2xl font-black text-slate-950">Create your account</h2>
    <p className="mt-2 text-sm text-slate-600">Already drive with us? <Link className="font-bold text-blue-700 underline" href="/driver/login">Sign in to your current account</Link> to keep your trips and history.</p>
    <form className="mt-5 space-y-4" onSubmit={event => void signUp(event)}>
      <label className="block text-sm font-semibold text-slate-800">Email<input className="moovu-input mt-2 w-full" required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label className="block text-sm font-semibold text-slate-800">Password<input className="moovu-input mt-2 w-full" required minLength={8} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <p className="text-sm text-slate-600">{PASSWORD_GUIDANCE}</p><button disabled={busy} className="moovu-btn moovu-btn-primary w-full sm:w-auto">{busy ? "Creating account…" : "Create account"}</button>
    </form><p role="status" aria-live="polite" className="mt-3 text-sm font-semibold text-blue-900">{message}</p>
  </section>;
}
