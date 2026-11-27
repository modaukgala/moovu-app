"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";

function ResetWithCode() {
  const router = useRouter();
  const params = useSearchParams();
  const isDriver = params.get("for") === "driver";
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/auth/reset-with-code", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, code, password }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!json?.ok) { setBusy(false); setMsg(json?.error ?? "Something went wrong. Try again."); return; }
    if (json.loginEmail) {
      const { error } = await supabaseClient.auth.signInWithPassword({ email: json.loginEmail, password });
      if (!error) { router.replace(isDriver ? "/driver" : "/book"); return; }
    }
    setBusy(false);
    setMsg("Password changed. Sign in with your new password.");
  }

  return (
    <main className="moovu-page min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto grid max-w-md gap-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Reset your password</h1>
          <p className="mt-1 text-sm text-slate-600">Get a 6-digit code from MOOVU on WhatsApp, then set a new password here.</p>
        </div>

        <section className="moovu-auth-card grid gap-3">
          <div className="text-sm font-semibold text-slate-900">1. Ask for a code</div>
          <a className="moovu-btn moovu-btn-secondary w-full" target="_blank" rel="noopener noreferrer"
            href={`/api/support/whatsapp?topic=${isDriver ? "driver-forgot" : "forgot"}`}>
            Message MOOVU on WhatsApp
          </a>
          <p className="text-xs text-slate-500">Send your name and the phone number on your account. We&apos;ll reply with your code.</p>
        </section>

        <section className="moovu-auth-card grid gap-3">
          <div className="text-sm font-semibold text-slate-900">2. Enter your code</div>
          <input className="moovu-input" placeholder={isDriver ? "Email or phone number" : "Phone number or email"}
            value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" />
          <input className="moovu-input" placeholder="6-digit code" inputMode="numeric" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code"
            style={{ letterSpacing: code ? "0.3em" : undefined }} />
          <input className="moovu-input" placeholder="New password (8+ characters)" type="password"
            value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          {msg && <p className="text-sm text-slate-700" role="status">{msg}</p>}
          <button type="button" className="moovu-btn moovu-btn-primary w-full"
            disabled={busy || !identifier.trim() || code.length !== 6 || password.length < 8} onClick={submit}>
            {busy ? "Saving…" : "Set new password"}
          </button>
        </section>

        <Link className="text-center text-sm font-semibold text-[#1f74c9]" href={isDriver ? "/driver/login" : "/customer/auth"}>Back to sign in</Link>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return <Suspense fallback={null}><ResetWithCode /></Suspense>;
}
