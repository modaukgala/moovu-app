"use client";

import { useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextPath, setNextPath] = useState("/admin");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawNext = params.get("next");
    if (rawNext && rawNext.startsWith("/")) {
      setNextPath(rawNext);
    }
  }, []);

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

    const host = window.location.host.toLowerCase();
    const isAdminHost =
      host === "admin.moovurides.co.za" ||
      host.startsWith("admin.localhost") ||
      host.startsWith("admin.127.0.0.1");

    let target = nextPath || "/admin";

    if (isAdminHost) {
      if (target === "/admin") target = "/";
      else if (target.startsWith("/admin/")) target = target.replace("/admin", "") || "/";
    }

    setLoading(false);
    window.location.href = target;
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