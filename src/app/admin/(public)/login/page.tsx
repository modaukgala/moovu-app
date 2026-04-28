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
      const timer = window.setTimeout(() => setNextPath(rawNext), 0);
      return () => window.clearTimeout(timer);
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
    <main className="moovu-auth-shell text-black">
      <form onSubmit={onSubmit} className="moovu-auth-card">
        <div className="moovu-section-title">MOOVU Admin</div>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">Sign in</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Sign in to manage drivers, dispatch, subscriptions and trips.
        </p>

        <div className="mt-6 space-y-4">
          <input
            className="moovu-input"
            placeholder="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="moovu-input"
            placeholder="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {err && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          )}

          <button disabled={loading} className="moovu-btn moovu-btn-primary w-full">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </div>
      </form>
    </main>
  );
}
