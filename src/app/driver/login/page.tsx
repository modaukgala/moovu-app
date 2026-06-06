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
    <main className="moovu-driver-landing text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <section className="moovu-driver-landing-grid">
        <div className="moovu-driver-landing-hero">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-16 w-16 place-items-center rounded-3xl border border-white/50 bg-white shadow-sm">
              <Image src="/logo.png" alt="MOOVU Kasi Rides" width={46} height={46} priority />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-100">
                MOOVU Driver
              </div>
              <div className="mt-1 text-sm font-bold text-white">
                Local driver operating system
              </div>
            </div>
          </div>

          <div className="inline-flex rounded-full bg-white/14 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-blue-50 ring-1 ring-white/25">
            Flexible local trips
          </div>
          <h1 className="mt-5 text-4xl font-black tracking-tight text-white sm:text-5xl">
            Drive with MOOVU
          </h1>
          <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-blue-50">
            Accept local trips, manage rides, and track your earnings from one simple driver app.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link href="/driver/apply" className="moovu-btn bg-white text-slate-950 shadow-lg">
              Apply to Drive
            </Link>
            <a href="#driver-sign-in" className="moovu-btn border border-white/35 bg-white/10 text-white">
              Driver Sign In
            </a>
          </div>

          <div className="moovu-driver-benefits mt-8">
            {[
              ["Flexible local trips", "Go online when you are available."],
              ["Clear earnings", "Track trips, commission and payouts."],
              ["Easy ride requests", "Review pickup, destination and fare fast."],
              ["OTP-secured trips", "Start and complete trips with rider OTPs."],
              ["Subscription access", "Keep driver access active in-app."],
              ["Local township demand", "Built for nearby everyday movement."],
            ].map(([title, body]) => (
              <div key={title} className="moovu-driver-benefit-card">
                <strong>{title}</strong>
                <span>{body}</span>
              </div>
            ))}
          </div>
        </div>

        <div id="driver-sign-in" className="moovu-auth-card moovu-driver-signin-card">
          <div className="mb-6">
            <div className="moovu-section-title">Driver sign in</div>
            <h2 className="mt-3 text-3xl font-black text-slate-950">
              Access your work app
            </h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
              Sign in to go online, accept trips, navigate, verify OTPs, and manage earnings.
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
              {busy ? "Signing in..." : "Driver Sign In"}
            </button>
          </section>

          <div className="mt-5 rounded-2xl bg-blue-50 p-4 text-sm font-semibold leading-6 text-blue-800">
            New driver? Apply first so MOOVU can review your profile, documents, and vehicle before you start driving.
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link href="/driver/apply" className="moovu-btn moovu-btn-secondary w-full">
              Apply to Drive
            </Link>

            <Link href="/" className="moovu-btn moovu-btn-secondary w-full">
              Back to customer app
            </Link>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-bold text-slate-500">
            <Link href="/driver/privacy-policy" className="hover:text-[#1f74c9]">Privacy Policy</Link>
            <Link href="/driver/terms" className="hover:text-[#1f74c9]">Terms</Link>
            <Link href="/driver/contact" className="hover:text-[#1f74c9]">Contact</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
