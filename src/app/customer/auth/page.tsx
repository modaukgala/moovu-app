"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import TimedPasswordField from "@/components/ui/TimedPasswordField";
import CustomerBackHomeNav from "@/components/app-shell/CustomerBackHomeNav";
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
  login_email?: string | null;
  error?: string;
};

type RegisterResponse = {
  ok?: boolean;
  error?: string;
  warning?: string;
  login_email?: string;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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
  const [loginAuthEmail, setLoginAuthEmail] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [existingName, setExistingName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failedLoginAttempts, setFailedLoginAttempts] = useState(0);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");

  const canCheck = useMemo(() => {
    const normalized = normalizePhoneZA(phone);
    return !!normalized || isEmail(phone);
  }, [phone]);

  async function checkPhone() {
    const identifier = phone.trim();
    const normalized = normalizePhoneZA(identifier);
    const identifierIsEmail = isEmail(identifier);

    if (!normalized && !identifierIsEmail) {
      setMsg("Enter a valid email address or cellphone number.");
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
        body: JSON.stringify({ identifier }),
      });

      const json = (await res.json()) as CheckPhoneResponse;

      if (!json?.ok) {
        setMsg(json?.error || "Failed to check customer account.");
        setBusy(false);
        return;
      }

      setNormalizedPhone(json.normalized_phone || normalized || "");
      setLoginAuthEmail(json.login_email || "");

      if (json.exists) {
        setExistingName(fullCustomerName(json.first_name, json.last_name));
        setStep("login");
      } else {
        setFirstName("");
        setLastName("");
        setEmail(identifierIsEmail ? identifier : "");
        setSignupPhone(normalized || "");
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
    const authEmail = loginAuthEmail || (normalized ? customerEmailFromPhone(normalized) : "");

    if (!authEmail) {
      setMsg("Please enter a valid email address or cellphone number.");
      return;
    }

    if (!password.trim()) {
      setMsg("Enter your password.");
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: authEmail,
        password,
      });

      if (error) {
        setFailedLoginAttempts((value) => value + 1);
        setMsg("The password was not accepted. Check it and try again.");
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
    const normalized = normalizedPhone || normalizePhoneZA(signupPhone) || normalizePhoneZA(phone);

    if (!normalized) {
      setMsg("Please enter a valid cellphone number.");
      return;
    }

    if (!firstName.trim() || !lastName.trim()) {
      setMsg("Enter your first name and surname.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMsg("Enter a valid email address.");
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
          email: email.trim(),
          phone: normalized,
          password,
          acceptedTerms: legalAccepted,
          acceptedPrivacy: legalAccepted,
          termsVersion: MOOVU_LEGAL_VERSION,
          privacyVersion: MOOVU_LEGAL_VERSION,
        }),
      });

      const json = (await res.json().catch(() => null)) as RegisterResponse | null;

      if (!json?.ok) {
        setMsg(json?.error || "Failed to create your account.");
        setBusy(false);
        return;
      }

      const loginEmail = json.login_email || customerEmailFromPhone(normalized);

      const { error } = await supabaseClient.auth.signInWithPassword({
        email: loginEmail,
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

  async function requestPasswordRecovery() {
    if (!isEmail(recoveryEmail)) {
      setMsg("Enter the registered email address.");
      return;
    }

    setBusy(true);
    try {
      await fetch("/api/customer/password-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: phone.trim(),
          email: recoveryEmail.trim().toLowerCase(),
        }),
      });
      setShowRecovery(false);
      setMsg("If an account matches these details, we’ll send recovery instructions.");
    } catch {
      setMsg("If an account matches these details, we’ll send recovery instructions.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="moovu-auth-shell text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-auth-card moovu-customer-auth-card">
        <CustomerBackHomeNav fallbackHref="/" homeHref="/" homeLabel="Home" />
        <div className="moovu-customer-task-hero mb-6">
          <div className="moovu-section-title">MOOVU Customer</div>
          <h1 className="mt-3 text-3xl font-black text-slate-950">
            Login or create account
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Enter your email address or cellphone number. After login you continue straight
            to booking.
          </p>
        </div>

        <section className="space-y-4">
          {step === "phone" && (
            <>
              <div className="moovu-auth-step-card">
                <h2 className="text-lg font-semibold text-slate-900">
                  Step 1: Email or cellphone
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  We will check whether you already have a customer account.
                </p>
              </div>

              <input
                className="moovu-input"
                placeholder="Email address or cellphone number"
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
              <div className="moovu-auth-step-card">
                <h2 className="text-lg font-semibold text-slate-900">Welcome back</h2>
                  <p className="mt-2 text-sm text-slate-600">
                  {existingName || "Customer"} was found for {phone.trim()}.
                </p>
              </div>

              <input className="moovu-input bg-slate-50" value={phone.trim()} readOnly />

              <TimedPasswordField
                className="moovu-input pr-16"
                placeholder="Password"
                value={password}
                onChange={setPassword}
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
              {failedLoginAttempts > 0 && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                  {!showRecovery ? (
                    <button
                      type="button"
                      className="text-sm font-black text-blue-700 underline underline-offset-4"
                      onClick={() => setShowRecovery(true)}
                    >
                      Forgot password?
                    </button>
                  ) : (
                    <div className="grid gap-3">
                      <p className="text-sm font-semibold leading-6 text-slate-700">
                        Enter the email registered with this account. MOOVU uses neutral responses to protect account privacy.
                      </p>
                      <input
                        className="moovu-input bg-white"
                        type="email"
                        placeholder="Registered email address"
                        value={recoveryEmail}
                        onChange={(event) => setRecoveryEmail(event.target.value)}
                        autoComplete="email"
                      />
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          className="moovu-btn moovu-btn-primary"
                          onClick={() => void requestPasswordRecovery()}
                          disabled={busy}
                        >
                          {busy ? "Sending..." : "Send recovery instructions"}
                        </button>
                        <Link className="moovu-btn moovu-btn-secondary" href="/contact">
                          No access to email?
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {step === "signup" && (
            <>
              <div className="moovu-auth-step-card">
                <h2 className="text-lg font-semibold text-slate-900">
                  Create your customer account
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  We could not find this account, so let us create a new one.
                </p>
              </div>

              {normalizedPhone ? (
                <input className="moovu-input bg-slate-50" value={normalizedPhone} readOnly />
              ) : (
                <input
                  className="moovu-input"
                  placeholder="Cellphone number"
                  value={signupPhone}
                  onChange={(e) => setSignupPhone(e.target.value)}
                />
              )}

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
                placeholder="Email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <TimedPasswordField
                className="moovu-input pr-16"
                placeholder="Password"
                value={password}
                onChange={setPassword}
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
                    setEmail("");
                    setSignupPhone("");
                    setLoginAuthEmail("");
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
