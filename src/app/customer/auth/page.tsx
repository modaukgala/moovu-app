"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";
import {
  customerEmailFromPhone,
  fullCustomerName,
  normalizePhoneZA,
} from "@/lib/customer/auth";

type CheckPhoneResponse = {
  ok: boolean;
  exists?: boolean;
  first_name?: string | null;
  last_name?: string | null;
  normalized_phone?: string | null;
  error?: string;
};

export default function CustomerAuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/book";

  const [step, setStep] = useState<"phone" | "login" | "signup">("phone");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [normalizedPhone, setNormalizedPhone] = useState("");
  const [existingName, setExistingName] = useState("");

  const [password, setPassword] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const canCheck = useMemo(() => !!normalizePhoneZA(phone), [phone]);

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
        headers: { "Content-Type": "application/json" },
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
        setStep("signup");
      }
    } catch (e: any) {
      setMsg(e?.message || "Failed to check customer account.");
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
    } catch (e: any) {
      setMsg(e?.message || "Login failed.");
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
    } catch (e: any) {
      setMsg(e?.message || "Failed to create your account.");
    }

    setBusy(false);
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">MOOVU Customer</div>
          <h1 className="text-3xl font-semibold mt-1">Login or Create Account</h1>
          <p className="text-gray-700 mt-2">
            Enter your cellphone number first. After login you will continue straight to booking.
          </p>
        </div>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          {step === "phone" && (
            <>
              <h2 className="text-xl font-semibold">Step 1: Cellphone Number</h2>

              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Cellphone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />

              <button
                className="rounded-xl px-4 py-3 text-white"
                style={{ background: "var(--moovu-primary)" }}
                disabled={busy || !canCheck}
                onClick={checkPhone}
              >
                {busy ? "Checking..." : "Continue"}
              </button>
            </>
          )}

          {step === "login" && (
            <>
              <h2 className="text-xl font-semibold">Welcome back</h2>
              <p className="text-gray-700">
                {existingName || "Customer"} was found for {normalizedPhone}.
              </p>

              <input
                className="border rounded-xl p-3 w-full bg-gray-100"
                value={normalizedPhone}
                readOnly
              />

              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <div className="flex flex-wrap gap-3">
                <button
                  className="rounded-xl px-4 py-3 text-white"
                  style={{ background: "var(--moovu-primary)" }}
                  disabled={busy}
                  onClick={login}
                >
                  {busy ? "Logging in..." : "Login"}
                </button>

                <button
                  className="border rounded-xl px-4 py-3"
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
              <h2 className="text-xl font-semibold">Create your customer account</h2>

              <input
                className="border rounded-xl p-3 w-full bg-gray-100"
                value={normalizedPhone}
                readOnly
              />

              <div className="grid md:grid-cols-2 gap-4">
                <input
                  className="border rounded-xl p-3"
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />

                <input
                  className="border rounded-xl p-3"
                  placeholder="Surname"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>

              <input
                className="border rounded-xl p-3 w-full"
                placeholder="Create password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <div className="flex flex-wrap gap-3">
                <button
                  className="rounded-xl px-4 py-3 text-white"
                  style={{ background: "var(--moovu-primary)" }}
                  disabled={busy}
                  onClick={register}
                >
                  {busy ? "Creating..." : "Create Account"}
                </button>

                <button
                  className="border rounded-xl px-4 py-3"
                  onClick={() => {
                    setStep("phone");
                    setPassword("");
                    setFirstName("");
                    setLastName("");
                  }}
                >
                  Back
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}