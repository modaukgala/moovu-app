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

  // Used only on signup to link the account to the driver record
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

    // 1) Create auth user
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

    // 2) Link this auth user to the driver record (RLS only allows own insert)
    const { error: linkErr } = await supabaseClient.from("driver_accounts").insert({
      user_id: userId,
      driver_id: dUuid,
    });

    setBusy(false);

    if (linkErr) {
      setMsg(
        "Account created but linking failed. Check: driver UUID is correct and not already linked to another account."
      );
      return;
    }

    setMsg("Signup + linking successful ✅ Redirecting...");
    router.push("/driver");
  }

  return (
    <main className="p-6 max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Moovu Driver</h1>
        <p className="opacity-70 mt-1">Login to accept trips.</p>
      </div>

      <div className="flex gap-2">
        <button
          className={`border rounded-xl px-4 py-2 ${mode === "login" ? "opacity-100" : "opacity-60"}`}
          onClick={() => setMode("login")}
        >
          Login
        </button>
        <button
          className={`border rounded-xl px-4 py-2 ${mode === "signup" ? "opacity-100" : "opacity-60"}`}
          onClick={() => setMode("signup")}
        >
          Sign up
        </button>
      </div>

      <section className="border rounded-2xl p-5 space-y-3">
        <input
          className="border rounded-xl p-3 w-full"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="border rounded-xl p-3 w-full"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {mode === "signup" && (
          <input
            className="border rounded-xl p-3 w-full"
            placeholder="Driver UUID (given by admin)"
            value={driverUuid}
            onChange={(e) => setDriverUuid(e.target.value)}
          />
        )}

        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

        {mode === "login" ? (
          <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={login}>
            {busy ? "Loading..." : "Login"}
          </button>
        ) : (
          <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={signupAndLink}>
            {busy ? "Creating..." : "Sign up & Link"}
          </button>
        )}
      </section>

      <p className="text-xs opacity-60">
        Admin gives you your Driver UUID once. After linking, you only login normally.
      </p>
    </main>
  );
}