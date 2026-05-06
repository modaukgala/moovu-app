"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";
import {
  customerEmailFromPhone,
  fullCustomerName,
  normalizePhoneZA,
} from "@/lib/customer/auth";
import { MOOVU_LEGAL_VERSION } from "@/lib/legal";

type CheckPhoneResponse = {
  ok: boolean;
  exists?: boolean;
  first_name?: string | null;
  last_name?: string | null;
  normalized_phone?: string | null;
  error?: string;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function CustomerAuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const nextPath = useMemo(() => {
    const rawNext = searchParams?.get("next");
    return rawNext && rawNext.startsWith("/") ? rawNext : "/book";
  }, [searchParams]);

  const [step, setStep] = useState<"phone" | "login" | "signup">("phone");
  const [phone, setPhone] = useState("");
  const [normalizedPhone, setNormalizedPhone] = useState("");
  const [existingName, setExistingName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const canCheck = useMemo(() => {
    const normalized = normalizePhoneZA(phone);
    return !!normalized && normalized.length >= 10;
  }, [phone]);

  async function checkPhone() {
    const normalized = normalizePhoneZA(phone);
    if (!normalized) {
      setMsg("Please enter a valid cellphone number.");
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const res = await fetch("/api/customer/check-phone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone: normalized }),
      });

      const json = (await res.json()) as CheckPhoneResponse;

      if (!json?.ok) {
        setMsg(json?.error || "Failed to check customer account.");
        setBusy(false);
        return;
      }

      setNormalizedPhone(json.normalized_phone || normalized);

      if (json.exists) {
        setExistingName(fullCustomerName(json.first_name, json.last_name));
        setStep("login");
      } else {
        setFirstName("");
        setLastName("");
        setLegalAccepted(false);
        setStep("signup");
      }
    } catch (e: unknown) {
      setMsg(errorMessage(e, "Failed to check customer account."));
    }

    setBusy(false);
  }

  async function login() {
    const normalized = normalizedPhone || normalizePhoneZA(phone);
    if (!normalized) {
      setMsg("Please enter a valid cellphone number.");
      return;
    }

    if (!password.trim()) {
      setMsg("Enter your password.");
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const email = customerEmailFromPhone(normalized);

      const { error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMsg(error.message);
        setBusy(false);
        return;
      }

      router.push(nextPath);
    } catch (e: unknown) {
      setMsg(errorMessage(e, "Login failed."));
    }

    setBusy(false);
  }

  async function register() {
    const normalized = normalizedPhone || normalizePhoneZA(phone);

    if (!normalized) {
      setMsg("Please enter a valid cellphone number.");
      return;
    }

    if (!firstName.trim() || !lastName.trim()) {
      setMsg("Enter your first name and surname.");
      return;
    }

    if (password.trim().length < 6) {
      setMsg("Password must be at least 6 characters.");
      return;
    }

    if (!legalAccepted) {
      setMsg("Please accept the MOOVU Terms of Service and Privacy Policy to create your account.");
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const res = await fetch("/api/customer/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          phone: normalized,
          password,
          acceptedTerms: legalAccepted,
          acceptedPrivacy: legalAccepted,
          termsVersion: MOOVU_LEGAL_VERSION,
          privacyVersion: MOOVU_LEGAL_VERSION,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setMsg(json?.error || "Failed to create your account.");
        setBusy(false);
        return;
      }

      const email = customerEmailFromPhone(normalized);

      const { error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMsg(error.message);
        setBusy(false);
        return;
      }

      router.push(nextPath);
    } catch (e: unknown) {
      setMsg(errorMessage(e, "Failed to create your account."));
    }

    setBusy(false);
  }

  return (
    <main className="moovu-auth-shell text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-auth-card">
        <div className="mb-6">
          <div className="moovu-section-title">MOOVU Customer</div>
          <h1 className="mt-3 text-3xl font-semibold text-slate-950">
            Login or create account
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Enter your cellphone number first. After login you continue straight
            to booking.
          </p>
        </div>

        <section className="space-y-4">
          {step === "phone" && (
            <>
              <div className="moovu-card-soft p-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Step 1: Cellphone number
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  We will check whether you already have a customer account.
                </p>
              </div>

              <input
                className="moovu-input"
                placeholder="Cellphone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />

              <button
                className="moovu-btn moovu-btn-primary w-full"
                disabled={busy || !canCheck}
                onClick={checkPhone}
              >
                {busy ? "Checking..." : "Continue"}
              </button>
            </>
          )}

          {step === "login" && (
            <>
              <div className="moovu-card-soft p-4">
                <h2 className="text-lg font-semibold text-slate-900">Welcome back</h2>
                <p className="mt-2 text-sm text-slate-600">
                  {existingName || "Customer"} was found for {normalizedPhone}.
                </p>
              </div>

              <input className="moovu-input bg-slate-50" value={normalizedPhone} readOnly />

              <input
                className="moovu-input"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <div className="flex flex-wrap gap-3">
                <button
                  className="moovu-btn moovu-btn-primary"
                  disabled={busy}
                  onClick={login}
                >
                  {busy ? "Logging in..." : "Login"}
                </button>

                <button
                  className="moovu-btn moovu-btn-secondary"
                  onClick={() => {
                    setStep("phone");
                    setPassword("");
                  }}
                >
                  Back
                </button>
              </div>
            </>
          )}

          {step === "signup" && (
            <>
              <div className="moovu-card-soft p-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Create your customer account
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  We could not find this number, so let’s create a new account.
                </p>
              </div>

              <input className="moovu-input bg-slate-50" value={normalizedPhone} readOnly />

              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  className="moovu-input"
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
                <input
                  className="moovu-input"
                  placeholder="Surname"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>

              <input
                className="moovu-input"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <label className="legal-consent-row">
                <input
                  type="checkbox"
                  checked={legalAccepted}
                  onChange={(e) => setLegalAccepted(e.target.checked)}
                />
                <span>
                  I agree to the MOOVU{" "}
                  <Link href="/terms" target="_blank" rel="noopener noreferrer">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer">
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>

              <div className="flex flex-wrap gap-3">
                <button
                  className="moovu-btn moovu-btn-primary"
                  disabled={busy || !legalAccepted}
                  onClick={register}
                >
                  {busy ? "Creating..." : "Create account"}
                </button>

                <button
                  className="moovu-btn moovu-btn-secondary"
                  onClick={() => {
                    setStep("phone");
                    setPassword("");
                    setLegalAccepted(false);
                  }}
                >
                  Back
                </button>
              </div>
            </>
          )}
        </section>

        <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-bold text-slate-500">
          <Link href="/privacy-policy" className="hover:text-[#1f74c9]">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-[#1f74c9]">Terms</Link>
          <Link href="/contact" className="hover:text-[#1f74c9]">Contact</Link>
        </div>
      </div>
    </main>
  );
}
