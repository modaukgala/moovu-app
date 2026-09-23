"use client";
import { useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

// External provider configuration is intentionally dormant in this release.
const oauthEnabled = { google: false, apple: false };
export default function Phase6Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function signUp(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    const { error } = await supabaseClient.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: new URL("/driver/onboarding", window.location.origin).href } });
    setPassword(""); setBusy(false);
    setMessage(error ? "Unable to create an account. Try signing in or contact support." : "Check your email to confirm your account, then sign in and start Driver onboarding. An Auth account alone does not grant Driver access.");
  }
  async function oauth(provider: "google" | "apple") {
    if (!oauthEnabled[provider]) return;
    const { error } = await supabaseClient.auth.signInWithOAuth({ provider, options: { redirectTo: new URL("/driver/onboarding", window.location.origin).href } });
    if (error) setMessage("Provider sign-in is unavailable.");
  }
  return <section className="my-6 rounded border p-4"><h2 className="text-lg font-semibold">New to MOOVU?</h2><form className="mt-3 space-y-3" onSubmit={event => void signUp(event)}><label className="block">Email<input className="block w-full rounded border p-3" required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label><label className="block">Password<input className="block w-full rounded border p-3" required minLength={12} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label><button disabled={busy} className="rounded border p-3">Create account</button></form><p role="status" className="mt-3">{message}</p><div className="mt-3 flex gap-3">{(["google", "apple"] as const).map(provider => <button key={provider} className="rounded border p-3" disabled={!oauthEnabled[provider] || busy} onClick={() => void oauth(provider)}>{provider === "google" ? "Google" : "Apple"} — configuration pending</button>)}</div></section>;
}
