"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";

export default function DriverLoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [driverUuid, setDriverUuid] = useState("");
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

  async function signupAndLink() {
    setBusy(true);
    setMsg(null);

    const dUuid = driverUuid.trim();
    if (!dUuid) {
      setBusy(false);
      setMsg("Please enter the Driver UUID given by admin.");
      return;
    }

    const { data, error } = await supabaseClient.auth.signUp({
      email: email.trim(),
      password,
    });

    if (error) {
      setBusy(false);
      setMsg(error.message);
      return;
    }

    const userId = data.user?.id;
    if (!userId) {
      setBusy(false);
      setMsg("Signup created but user not returned. Please login then try again.");
      return;
    }

    const { error: linkErr } = await supabaseClient.from("driver_accounts").insert({
      user_id: userId,
      driver_id: dUuid,
    });

    setBusy(false);

    if (linkErr) {
      setMsg(
        "Account created but linking failed. Check that the driver UUID is correct and not already linked."
      );
      return;
    }

    setMsg("Signup + linking successful ✅ Redirecting...");
    router.push("/driver");
  }

  return (
    <main className="moovu-auth-shell text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-auth-card">
        <div className="mb-6">
          <div className="moovu-section-title">MOOVU Driver</div>
          <h1 className="mt-3 text-3xl font-semibold text-slate-950">
            Driver access
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Sign in to accept trips, update your location and manage active rides.
          </p>
        </div>

        <div className="mb-5 inline-flex rounded-2xl bg-slate-100 p-1">
          <button
            className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
              mode === "login"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-600"
            }`}
            onClick={() => setMode("login")}
          >
            Login
          </button>
          <button
            className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
              mode === "signup"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-600"
            }`}
            onClick={() => setMode("signup")}
          >
            Sign up
          </button>
        </div>

        <section className="space-y-4">
          <input
            className="moovu-input"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="moovu-input"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {mode === "signup" && (
            <input
              className="moovu-input"
              placeholder="Driver UUID (given by admin)"
              value={driverUuid}
              onChange={(e) => setDriverUuid(e.target.value)}
            />
          )}

          {mode === "login" ? (
            <button
              className="moovu-btn moovu-btn-primary w-full"
              disabled={busy}
              onClick={login}
            >
              {busy ? "Loading..." : "Login"}
            </button>
          ) : (
            <button
              className="moovu-btn moovu-btn-primary w-full"
              disabled={busy}
              onClick={signupAndLink}
            >
              {busy ? "Creating..." : "Sign up & link"}
            </button>
          )}
        </section>

        <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-600">
          Admin gives you your driver UUID once. After linking, you only log in normally.
        </div>
      </div>
    </main>
  );
}