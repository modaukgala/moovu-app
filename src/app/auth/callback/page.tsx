"use client";

import { useEffect, useState } from "react";
import { completeAuthFromUrl, takeRememberedNext } from "@/lib/auth/socialAuth";

/** Web (browser) return point for Google/Apple sign-in and account linking. */
export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void completeAuthFromUrl(window.location.href)
      .then(() => window.location.replace(takeRememberedNext("/")))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Sign-in failed."));
  }, []);
  return (
    <main className="moovu-app-screen" style={{ display: "grid", placeItems: "center", minHeight: "60vh", padding: 24 }}>
      {error ? (
        <div style={{ textAlign: "center" }}>
          <p style={{ fontWeight: 700 }}>{error}</p>
          <a href="/customer/auth" className="moovu-btn moovu-btn-primary" style={{ marginTop: 16 }}>Try again</a>
        </div>
      ) : <p style={{ fontWeight: 700 }}>Signing you in…</p>}
    </main>
  );
}
