"use client";

import { useState } from "react";
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
        {complete ? (
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
