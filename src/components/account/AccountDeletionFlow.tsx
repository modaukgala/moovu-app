"use client";

import Link from "next/link";
import { useState } from "react";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type AccountDeletionFlowProps = {
  role: "customer" | "driver";
  apiPath: string;
  accountPath: string;
  loginPath: string;
  homePath: string;
};

type Step = "warning" | "verify" | "confirm" | "deleted";

export default function AccountDeletionFlow({
  role,
  apiPath,
  accountPath,
  loginPath,
  homePath,
}: AccountDeletionFlowProps) {
  const [step, setStep] = useState<Step>("warning");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function deleteAccount() {
    if (confirmText !== "DELETE") {
      setMessage("Type DELETE exactly to confirm account deletion.");
      return;
    }

    if (!password.trim()) {
      setMessage("Enter your password to verify your identity.");
      setStep("verify");
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!session) {
        window.location.href = loginPath;
        return;
      }

      const res = await fetch(apiPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          password,
          confirmText,
          reason,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMessage(json?.error || "We could not delete your account. Please try again.");
        return;
      }

      await supabaseClient.auth.signOut({ scope: "local" }).catch(() => {});
      setStep("deleted");
    } catch (error) {
      console.error("[account-deletion] client delete failed", error);
      setMessage("We could not delete your account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "deleted") {
    return (
      <main className="moovu-page min-h-screen pb-24 text-slate-950">
        <div className="moovu-shell flex min-h-[80svh] max-w-3xl items-center py-8">
          <section className="moovu-card w-full p-6 text-center sm:p-8">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700">
              ✓
            </div>
            <div className="moovu-section-title mt-5 text-emerald-700">Account deleted</div>
            <h1 className="mt-3 text-3xl font-black">Account Deleted</h1>
            <p className="mx-auto mt-4 max-w-xl text-sm font-semibold leading-6 text-slate-600">
              Your account has been successfully deleted.
            </p>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
              Any legally required records have been retained in accordance with applicable regulations.
            </p>
            <Link href={homePath} className="moovu-btn moovu-btn-primary mt-7 w-full sm:w-auto">
              Return to Home
            </Link>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="moovu-page min-h-screen pb-28 text-slate-950">
      {message && <CenteredMessageBox title="Action needs attention" message={message} onClose={() => setMessage(null)} />}

      <div className="moovu-shell max-w-3xl space-y-5 py-6">
        <section className="moovu-card p-5 sm:p-7">
          <div className="moovu-section-title text-red-700">Delete account</div>
          <h1 className="mt-2 text-3xl font-black">Delete Account</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
            This is the permanent account deletion flow for your MOOVU {role === "driver" ? "Driver" : "Customer"} app.
          </p>
        </section>

        <section className="moovu-card border border-red-100 bg-red-50/70 p-5 shadow-[0_20px_60px_rgba(220,38,38,0.10)] sm:p-7">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-red-600 text-xl font-black text-white">
              !
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-950">Delete Account</h2>
              <p className="mt-3 text-sm font-bold leading-6 text-slate-800">
                Deleting your account is permanent.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl bg-white p-4">
              <h3 className="text-sm font-black text-slate-950">The following information will be removed:</h3>
              <ul className="mt-3 space-y-2 text-sm font-semibold leading-6 text-slate-700">
                <li>• Profile information</li>
                <li>• Saved locations</li>
                <li>• Preferences</li>
                <li>• Messages where legally permitted</li>
              </ul>
            </div>
            <div className="rounded-3xl bg-white p-4">
              <h3 className="text-sm font-black text-slate-950">The following may be retained if legally required:</h3>
              <ul className="mt-3 space-y-2 text-sm font-semibold leading-6 text-slate-700">
                <li>• Trip history</li>
                <li>• Receipts and invoices</li>
                <li>• Tax records</li>
                <li>• Fraud prevention records</li>
                <li>• Safety records</li>
              </ul>
            </div>
          </div>

          <p className="mt-5 rounded-3xl border border-red-200 bg-white px-4 py-3 text-sm font-black text-red-700">
            This action cannot be undone.
          </p>

          {step === "warning" && (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href={accountPath} className="moovu-btn moovu-btn-secondary w-full sm:w-auto">
                Cancel
              </Link>
              <button type="button" className="moovu-btn bg-red-600 text-white" onClick={() => setStep("verify")}>
                Continue
              </button>
            </div>
          )}
        </section>

        {step !== "warning" && (
          <section className="moovu-card p-5 sm:p-7">
            <div className="moovu-section-title">Verify identity</div>
            <h2 className="mt-2 text-2xl font-black">Re-authentication</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
              Enter your password before deleting this account. This prevents someone else from deleting your account on this device.
            </p>
            <input
              className="moovu-input mt-5"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
            />
            {step === "verify" && (
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button type="button" className="moovu-btn moovu-btn-secondary" onClick={() => setStep("warning")}>
                  Back
                </button>
                <button
                  type="button"
                  className="moovu-btn moovu-btn-primary"
                  disabled={!password.trim()}
                  onClick={() => setStep("confirm")}
                >
                  Verify and continue
                </button>
              </div>
            )}
          </section>
        )}

        {step === "confirm" && (
          <section className="moovu-card p-5 sm:p-7">
            <div className="moovu-section-title text-red-700">Final confirmation</div>
            <h2 className="mt-2 text-2xl font-black">Type DELETE to confirm</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
              Your account will be deleted immediately after confirmation. No admin approval or support request is required.
            </p>
            <textarea
              className="moovu-input mt-5 min-h-24"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Optional reason"
            />
            <input
              className="moovu-input mt-3"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="Type DELETE"
              autoCapitalize="characters"
            />
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button type="button" className="moovu-btn moovu-btn-secondary" disabled={busy} onClick={() => setStep("verify")}>
                Back
              </button>
              <button
                type="button"
                className="moovu-btn bg-red-600 text-white disabled:opacity-60"
                disabled={busy || confirmText !== "DELETE"}
                onClick={deleteAccount}
              >
                {busy ? "Deleting account..." : "Delete Account"}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
