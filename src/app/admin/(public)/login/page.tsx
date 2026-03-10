"use client";

import { useMemo, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const nextPath = useMemo(() => {
    const raw = searchParams.get("next");

    if (!raw || !raw.startsWith("/")) {
      return "/admin";
    }

    return raw;
  }, [searchParams]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      setLoading(false);
      setErr(error?.message ?? "Login failed");
      return;
    }

    setLoading(false);

    router.push(nextPath);
    router.refresh();
  }

  return (
    <div className="min-h-screen grid place-items-center p-6 text-black">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-[2rem] border p-6 shadow-sm bg-white"
      >
        <div className="text-sm text-gray-500">MOOVU Admin</div>
        <h1 className="text-2xl font-semibold text-black mt-1">Sign in</h1>
        <p className="text-sm text-gray-700 mt-2">
          Sign in to manage drivers, dispatch and trips.
        </p>

        <div className="mt-6 space-y-3">
          <input
            className="w-full rounded-xl border p-3 bg-white text-black"
            placeholder="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="w-full rounded-xl border p-3 bg-white text-black"
            placeholder="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {err && <p className="text-sm text-red-600">{err}</p>}

          <button
            disabled={loading}
            className="w-full rounded-xl p-3 font-medium text-white"
            style={{ background: "var(--moovu-primary)" }}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}