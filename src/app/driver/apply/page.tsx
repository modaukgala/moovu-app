"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";

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

    setMsg("Application submitted ✅ Please wait for admin approval/linking.");

    // If email confirmation is enabled, the user may need to confirm before login.
    router.push("/driver/login");
  }

  return (
    <main className="p-6 max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Apply to Drive</h1>
        <p className="opacity-70 mt-1">Create your driver account and submit your application.</p>
      </div>

      <section className="border rounded-2xl p-5 space-y-3">
        <input
          className="border rounded-xl p-3 w-full"
          placeholder="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <input
          className="border rounded-xl p-3 w-full"
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <input
          className="border rounded-xl p-3 w-full"
          placeholder="Email (this will be your username)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <textarea
          className="border rounded-xl p-3 w-full min-h-[90px]"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="border-t pt-3 opacity-80 text-sm">Set your password</div>
        <input
          className="border rounded-xl p-3 w-full"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          className="border rounded-xl p-3 w-full"
          placeholder="Re-enter password"
          type="password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
        />

        {msg && <div className="text-sm">{msg}</div>}

        <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={apply}>
          {busy ? "Submitting..." : "Submit Application"}
        </button>
      </section>
    </main>
  );
}