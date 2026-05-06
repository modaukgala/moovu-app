"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";

export default function DriverLoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function login() {
    setBusy(true);
    setMsg(null);

    const { error } = await supabaseClient.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setBusy(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    router.push("/driver");
  }

  return (
    <main className="moovu-auth-shell text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-auth-card">
        <div className="mb-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-16 w-16 place-items-center rounded-3xl border border-[var(--moovu-border)] bg-white shadow-sm">
              <Image src="/logo.png" alt="MOOVU Kasi Rides" width={46} height={46} priority />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                MOOVU Driver
              </div>
              <div className="mt-1 text-sm font-bold text-[var(--moovu-primary)]">
                Work app
              </div>
            </div>
          </div>
          <div className="moovu-section-title">MOOVU Driver</div>
          <h1 className="mt-3 text-3xl font-semibold text-slate-950">
            Driver access
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Sign in to accept trips, update your location and manage active rides.
          </p>
        </div>

        <section className="space-y-4">
          <input
            className="moovu-input"
            placeholder="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="moovu-input"
            placeholder="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            className="moovu-btn moovu-btn-primary w-full"
            disabled={busy}
            onClick={login}
          >
            {busy ? "Signing in..." : "Login"}
          </button>
        </section>

        <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          New driver?
          <span className="mx-1" />
          Apply first so MOOVU can review your details and vehicle before you start driving.
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <Link href="/driver/apply" className="moovu-btn moovu-btn-secondary w-full">
            Become a Driver
          </Link>

          <Link href="/" className="moovu-btn moovu-btn-secondary w-full">
            Back to home
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-bold text-slate-500">
          <Link href="/privacy-policy" className="hover:text-[#1f74c9]">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-[#1f74c9]">Terms</Link>
          <Link href="/contact" className="hover:text-[#1f74c9]">Contact</Link>
        </div>
      </div>
    </main>
  );
}
