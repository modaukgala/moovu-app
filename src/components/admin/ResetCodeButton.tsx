"use client";

import { useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { waLinkZA } from "@/lib/whatsapp";

/** Admin: make a one-time reset code and send it to the person on WhatsApp. */
export default function ResetCodeButton({ customerId, driverId }: { customerId?: string; driverId?: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code: string; message: string; phone: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!window.confirm("Only do this after checking on WhatsApp that this is really the account owner (name and number match). Create a reset code?")) return;
    setBusy(true); setError(null);
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch("/api/admin/reset-code", {
      method: "POST", cache: "no-store",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, driverId }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setBusy(false);
    if (!json?.ok) { setError(json?.error ?? "Could not create a code."); return; }
    setResult(json);
  }

  const wa = result ? waLinkZA(result.phone, result.message) : null;
  return (
    <>
      <button type="button" className="ad-btn" disabled={busy} onClick={create}>{busy ? "Creating…" : "Reset code"}</button>
      {error && <span className="text-xs text-red-700">{error}</span>}
      {result && (
        <div className="ad-card mt-2 w-full" role="status">
          <div className="text-sm">Reset code (works once, 15 min):</div>
          <div style={{ fontSize: 28, fontWeight: 650, letterSpacing: "0.3em", color: "#1f74c9" }}>{result.code}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {wa && <a className="ad-btn is-primary" href={wa} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>}
            <button type="button" className="ad-btn" onClick={() => void navigator.clipboard?.writeText(result.message)}>Copy message</button>
            <button type="button" className="ad-btn" onClick={() => setResult(null)}>Done</button>
          </div>
        </div>
      )}
    </>
  );
}
