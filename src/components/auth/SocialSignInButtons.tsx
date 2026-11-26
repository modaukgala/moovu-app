"use client";

import { useEffect, useState } from "react";
import { signInWithProvider, socialSignInAvailable, type SocialProvider } from "@/lib/auth/socialAuth";

/** "Continue with Google / Apple" buttons for customer and driver sign-in. */
export default function SocialSignInButtons({ next }: { next: string }) {
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  useEffect(() => { setAvailable(socialSignInAvailable()); }, []);
  const go = async (provider: SocialProvider) => {
    setBusy(provider); setError(null);
    try { await signInWithProvider(provider, next); }
    catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed."); }
    finally { setBusy(null); }
  };
  if (!available) return null;
  return (
    <div className="moovu-social-auth">
      <button type="button" className="moovu-social-btn" disabled={busy !== null} onClick={() => void go("google")}>
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        {busy === "google" ? "Opening Google…" : "Continue with Google"}
      </button>
      <button type="button" className="moovu-social-btn moovu-social-apple" disabled={busy !== null} onClick={() => void go("apple")}>
        <svg width="18" height="20" viewBox="0 0 17 20" fill="currentColor" aria-hidden="true"><path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.6 4.8 2 5.8 1.1 7.4-.8 10.6.6 15.4 2.4 18c.9 1.3 1.9 2.7 3.3 2.6 1.3-.1 1.8-.8 3.4-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.1-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.9-1.1-2.9-4.4zM11.6 2.9c.7-.9 1.2-2.1 1.1-2.9-1 .1-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.1.1 2.3-.6 3-1.8z"/></svg>
        {busy === "apple" ? "Opening Apple…" : "Continue with Apple"}
      </button>
      {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
      <div className="moovu-social-divider"><span>or</span></div>
    </div>
  );
}
