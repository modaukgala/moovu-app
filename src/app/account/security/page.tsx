"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CustomerBackHomeNav from "@/components/app-shell/CustomerBackHomeNav";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { normalizePhoneZA } from "@/lib/customer/auth";
import { supabaseClient } from "@/lib/supabase/client";

type CustomerProfile = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
};

type ProfileResponse = {
  ok?: boolean;
  error?: string;
  customer?: CustomerProfile;
  verified_auth_email?: string | null;
  verified_auth_phone?: string | null;
};

export default function CustomerSecurityPage() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [busy, setBusy] = useState<"email" | "phone" | "verify" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadAndSyncProfile = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/customer/auth?next=/account/security";
      return;
    }

    const response = await fetch("/api/customer/me", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const json = (await response.json().catch(() => null)) as ProfileResponse | null;

    if (!response.ok || !json?.ok || !json.customer) {
      setMessage(json?.error || "Could not load your account security details.");
      return;
    }

    let nextProfile = json.customer;
    const verifiedEmail = String(json.verified_auth_email ?? "").trim().toLowerCase();
    const verifiedPhone = normalizePhoneZA(json.verified_auth_phone);
    const storedEmail = String(nextProfile.email ?? "").trim().toLowerCase();
    const storedPhone = normalizePhoneZA(nextProfile.phone);

    if (
      (verifiedEmail && verifiedEmail !== storedEmail) ||
      (verifiedPhone && verifiedPhone !== storedPhone)
    ) {
      const syncResponse = await fetch("/api/customer/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          first_name: nextProfile.first_name,
          last_name: nextProfile.last_name,
          email: verifiedEmail || storedEmail,
          phone: verifiedPhone || storedPhone,
        }),
      });
      const syncJson = (await syncResponse.json().catch(() => null)) as ProfileResponse | null;
      if (syncResponse.ok && syncJson?.ok && syncJson.customer) {
        nextProfile = syncJson.customer;
        setMessage("Your verified contact details are now updated.");
      }
    }

    setProfile(nextProfile);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAndSyncProfile();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAndSyncProfile]);

  async function requestEmailChange() {
    const email = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage("Enter a valid new email address.");
      return;
    }

    setBusy("email");
    const { error } = await supabaseClient.auth.updateUser(
      { email },
      { emailRedirectTo: `${window.location.origin}/account/security` },
    );
    setBusy(null);

    if (error) {
      setMessage("We could not send the email verification. Please try again.");
      console.error("[customer-security] email verification request failed", error);
      return;
    }

    setMessage("Check the new email address and open the MOOVU verification link to finish the change.");
  }

  async function requestPhoneChange() {
    const phone = normalizePhoneZA(newPhone);
    if (!phone) {
      setMessage("Enter a valid South African cellphone number.");
      return;
    }

    setBusy("phone");
    const { error } = await supabaseClient.auth.updateUser({ phone });
    setBusy(null);

    if (error) {
      setMessage(
        error.message.toLowerCase().includes("sms")
          ? "Cellphone verification is temporarily unavailable. Contact MOOVU Support."
          : "We could not send the verification code. Please try again.",
      );
      console.error("[customer-security] phone verification request failed", error);
      return;
    }

    setPhoneOtpSent(true);
    setMessage("Enter the verification code sent to the new cellphone number.");
  }

  async function verifyPhoneChange() {
    const phone = normalizePhoneZA(newPhone);
    if (!phone || phoneOtp.trim().length < 4) {
      setMessage("Enter the verification code sent to your new cellphone number.");
      return;
    }

    setBusy("verify");
    const { error } = await supabaseClient.auth.verifyOtp({
      phone,
      token: phoneOtp.trim(),
      type: "phone_change",
    });

    if (error) {
      setBusy(null);
      setMessage("The verification code is invalid or expired. Request a new code and try again.");
      console.error("[customer-security] phone verification failed", error);
      return;
    }

    await supabaseClient.auth.refreshSession();
    await loadAndSyncProfile();
    setBusy(null);
    setPhoneOtpSent(false);
    setPhoneOtp("");
    setNewPhone("");
  }

  return (
    <main className="moovu-page min-h-screen pb-32 text-slate-950">
      {message && <CenteredMessageBox message={message} onClose={() => setMessage(null)} />}

      <div className="moovu-shell max-w-3xl space-y-5 py-6">
        <CustomerBackHomeNav fallbackHref="/account" homeHref="/book" />

        <section className="moovu-card p-5 sm:p-7">
          <div className="moovu-section-title">Account security</div>
          <h1 className="mt-2 text-3xl font-black">Verified contact details</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            MOOVU updates email and cellphone details only after you prove control of the new contact method.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Contact label="Current email" value={profile?.email || "Not captured"} />
            <Contact label="Current cellphone" value={profile?.phone || "Not captured"} />
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-7">
          <div className="moovu-section-title">Change email</div>
          <h2 className="mt-2 text-2xl font-black">Verify a new email address</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The current email remains active until you open the secure verification link sent to the new address.
          </p>
          <input
            className="moovu-input mt-5"
            type="email"
            placeholder="New email address"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            autoComplete="email"
          />
          <button
            className="moovu-btn moovu-btn-primary mt-4"
            onClick={() => void requestEmailChange()}
            disabled={busy !== null}
          >
            {busy === "email" ? "Sending..." : "Send verification link"}
          </button>
        </section>

        <section className="moovu-card p-5 sm:p-7">
          <div className="moovu-section-title">Change cellphone</div>
          <h2 className="mt-2 text-2xl font-black">Verify a new cellphone number</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            A one-time code is required. SMS delivery depends on the verified Supabase phone provider configured for MOOVU.
          </p>
          <input
            className="moovu-input mt-5"
            placeholder="New cellphone number"
            value={newPhone}
            onChange={(event) => setNewPhone(event.target.value)}
            autoComplete="tel"
          />
          {phoneOtpSent && (
            <input
              className="moovu-input mt-3"
              inputMode="numeric"
              placeholder="Verification code"
              value={phoneOtp}
              onChange={(event) => setPhoneOtp(event.target.value.replace(/\D/g, "").slice(0, 8))}
            />
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="moovu-btn moovu-btn-primary"
              onClick={() => void (phoneOtpSent ? verifyPhoneChange() : requestPhoneChange())}
              disabled={busy !== null}
            >
              {busy === "phone"
                ? "Sending..."
                : busy === "verify"
                  ? "Verifying..."
                  : phoneOtpSent
                    ? "Verify cellphone"
                    : "Send verification code"}
            </button>
            {phoneOtpSent && (
              <button
                className="moovu-btn moovu-btn-secondary"
                onClick={() => void requestPhoneChange()}
                disabled={busy !== null}
              >
                Resend code
              </button>
            )}
          </div>
        </section>

        <section className="moovu-card border border-amber-100 bg-amber-50/60 p-5 sm:p-7">
          <div className="moovu-section-title text-amber-800">Account recovery</div>
          <h2 className="mt-2 text-2xl font-black">No access to either contact?</h2>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            Contact MOOVU Support for account recovery. Contact details are never replaced using names or trip history alone.
          </p>
          <Link href="/contact" className="moovu-btn moovu-btn-secondary mt-5">
            Contact MOOVU Support
          </Link>
        </section>
      </div>

      <CustomerBottomNav />
    </main>
  );
}

function Contact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
      <div className="text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
        {label}
      </div>
      <div className="mt-2 break-all text-sm font-black text-slate-950">{value}</div>
      <div className="mt-2 text-xs font-bold text-emerald-700">Verified</div>
    </div>
  );
}
