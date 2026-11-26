"use client";

import { useEffect, useState } from "react";
import { linkProvider, needsSocialLink, type SocialProvider } from "@/lib/auth/socialAuth";

const DISMISS_KEY = "moovu:link-prompt-dismissed-until";

/**
 * After login, invites email/password users to add Google or Apple sign-in.
 * Linking keeps the SAME account: trips, earnings and history stay.
 */
export default function LinkSignInPrompt({ next }: { next: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    try {
      const until = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
      if (until > Date.now()) return;
    } catch {}
    let t: ReturnType<typeof setTimeout>;
    // Wait until the notification pop-up is closed so only one shows at a time.
    const tryOpen = () => {
      if (!active) return;
      if (document.querySelector(".moovu-permission-reminder-backdrop")) {
        t = setTimeout(tryOpen, 2000);
        return;
      }
      void needsSocialLink().then((need) => { if (active && need) setOpen(true); });
    };
    t = setTimeout(tryOpen, 4000);
    return () => { active = false; clearTimeout(t); };
  }, []);

  if (!open) return null;
  const later = () => {
    try { window.localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 24 * 3600 * 1000)); } catch {}
    setOpen(false);
  };
  const link = async (provider: SocialProvider) => {
    setBusy(provider); setError(null);
    try { await linkProvider(provider, next); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't link right now."); setBusy(null); }
  };

  return (
    <div className="moovu-link-prompt" role="dialog" aria-modal="true" aria-labelledby="moovu-link-title">
      <div className="moovu-link-card">
        <h2 id="moovu-link-title">Sign in faster next time</h2>
        <p>Add Google or Apple to your MOOVU account. It&apos;s the same account: your trips and details stay.</p>
        <button type="button" className="moovu-social-btn" disabled={busy !== null} onClick={() => void link("google")}>{busy === "google" ? "Opening Google…" : "Use Google to sign in"}</button>
        <button type="button" className="moovu-social-btn moovu-social-apple" disabled={busy !== null} onClick={() => void link("apple")}>{busy === "apple" ? "Opening Apple…" : "Use Apple to sign in"}</button>
        {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
        <button type="button" className="moovu-link-later" onClick={later}>Not now</button>
      </div>
    </div>
  );
}
