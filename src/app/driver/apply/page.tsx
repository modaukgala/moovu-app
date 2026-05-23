"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";

export default function DriverApplyPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function apply() {
    setMsg(null);

    if (!email.trim() || !password) {
      setMsg("Email and password are required.");
      return;
    }
    if (password !== password2) {
      setMsg("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setMsg("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);

    // 1) Create auth account
    const { data: signup, error: signupErr } = await supabaseClient.auth.signUp({
      email: email.trim(),
      password,
    });

    if (signupErr) {
      setBusy(false);
      setMsg(signupErr.message);
      return;
    }

    const userId = signup.user?.id;
    if (!userId) {
      setBusy(false);
      setMsg("Signup completed but user id not returned.");
      return;
    }

    // 2) Finalize application on server (service role)
    const res = await fetch("/api/driver/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        fullName,
        phone,
        email: email.trim(),
        notes,
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Failed to submit application");
      return;
    }

    setMsg("Application submitted. Please wait for admin approval/linking.");

    // If email confirmation is enabled, the user may need to confirm before login.
    router.push("/driver/login");
  }

  return (
    <main className="moovu-page moovu-driver-shell min-h-screen text-slate-950">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-shell max-w-5xl space-y-6 py-6">
        <section className="moovu-card overflow-hidden p-0">
          <div className="bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-5 sm:p-7">
            <div className="moovu-section-title">MOOVU Driver onboarding</div>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">
              Apply to drive with MOOVU
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Create your driver login and submit your first application details. Admin approval still happens before you can go online.
            </p>
          </div>
          <div className="grid gap-3 border-t border-[var(--moovu-border)] p-4 sm:grid-cols-3">
            <div className="moovu-card-interactive p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-sky-700">1. Account</div>
              <p className="mt-2 text-sm text-slate-600">Use a real email and secure password.</p>
            </div>
            <div className="moovu-card-interactive p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">2. Details</div>
              <p className="mt-2 text-sm text-slate-600">Add contact details for admin review.</p>
            </div>
            <div className="moovu-card-interactive p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">3. Approval</div>
              <p className="mt-2 text-sm text-slate-600">Complete profile after approval/linking.</p>
            </div>
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <h2 className="text-2xl font-black">Driver application</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                This creates your driver login and sends your application to MOOVU operations.
              </p>
              <div className="mt-5 rounded-3xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                Use the same email when signing in later. Your phone number helps admin match your application to your driver profile.
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <input className="moovu-input" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                <input className="moovu-input" placeholder="Cellphone number" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <input className="moovu-input" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
              <textarea className="moovu-input min-h-[110px] resize-none" placeholder="Notes for MOOVU admin (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

              <div className="rounded-3xl border border-[var(--moovu-border)] bg-white p-4">
                <div className="text-sm font-black text-slate-950">Set your password</div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <input className="moovu-input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <input className="moovu-input" placeholder="Re-enter password" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
                </div>
              </div>

              <button className="moovu-btn moovu-btn-primary w-full justify-center" disabled={busy} onClick={apply}>
                {busy ? "Submitting..." : "Submit application"}
              </button>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-bold text-slate-500">
          <Link href="/privacy-policy" className="hover:text-[#1f74c9]">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-[#1f74c9]">Terms</Link>
          <Link href="/contact" className="hover:text-[#1f74c9]">Contact</Link>
        </div>
      </div>
    </main>
  );
}
