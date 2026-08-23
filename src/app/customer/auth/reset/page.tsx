"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import CustomerBackHomeNav from "@/components/app-shell/CustomerBackHomeNav";
import TimedPasswordField from "@/components/ui/TimedPasswordField";
import { supabaseClient } from "@/lib/supabase/client";

export default function CustomerPasswordResetPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [recoveryState, setRecoveryState] = useState<"checking" | "ready" | "invalid">("checking");

  useEffect(() => {
    let active = true;

    async function establishRecoverySession() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (code) {
        const { error } = await supabaseClient.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("[customer-password-reset] code exchange failed", error);
        } else {
          window.history.replaceState({}, "", url.pathname);
        }
      }

      const { data } = await supabaseClient.auth.getSession();
      if (active) setRecoveryState(data.session ? "ready" : "invalid");
    }

    const { data: authListener } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) setRecoveryState("ready");
    });

    void establishRecoverySession();

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function updatePassword() {
    if (password.length < 8) {
      setMessage("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("The passwords do not match.");
      return;
    }

    setBusy(true);
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setMessage("This recovery link is invalid or expired. Request a new link and try again.");
      console.error("[customer-password-reset] password update failed", error);
      return;
    }

    await supabaseClient.auth.signOut({ scope: "global" });
    setBusy(false);
    setComplete(true);
  }

  return (
    <main className="moovu-auth-shell text-slate-950">
      {message && <CenteredMessageBox message={message} onClose={() => setMessage(null)} />}
      <div className="moovu-auth-card moovu-customer-auth-card">
        <CustomerBackHomeNav fallbackHref="/customer/auth?next=/book" homeHref="/" />
        <div className="moovu-section-title mt-5">Account recovery</div>
        <h1 className="mt-2 text-3xl font-black">
          {complete ? "Password updated" : "Create a new password"}
        </h1>
        {recoveryState === "checking" ? (
          <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm font-semibold text-blue-800">
            Checking your secure recovery link...
          </div>
        ) : recoveryState === "invalid" ? (
          <div className="mt-5">
            <h2 className="text-xl font-black">Reset link expired</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
              This password reset link is invalid, expired, or has already been used.
            </p>
            <Link className="moovu-btn moovu-btn-primary mt-5" href="/customer/auth?next=/book">
              Request a new link
            </Link>
          </div>
        ) : complete ? (
          <div className="mt-5">
            <p className="text-sm font-semibold leading-6 text-slate-600">
              Your old sessions have been signed out. Log in again with your new password.
            </p>
            <Link className="moovu-btn moovu-btn-primary mt-5" href="/customer/auth?next=/book">
              Return to login
            </Link>
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            <TimedPasswordField
              className="moovu-input pr-16"
              placeholder="New password"
              value={password}
              onChange={setPassword}
            />
            <TimedPasswordField
              className="moovu-input pr-16"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />
            <button
              className="moovu-btn moovu-btn-primary"
              onClick={() => void updatePassword()}
              disabled={busy}
            >
              {busy ? "Updating..." : "Update password"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
