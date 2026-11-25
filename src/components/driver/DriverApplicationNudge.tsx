"use client";

import { useEffect, useState } from "react";
import { FileCheck2, X } from "lucide-react";
import { applicationNudge, type ApplicationNudge } from "@/lib/drivers/applicationNudge";
import { supabaseClient } from "@/lib/supabase/client";

type Review = { action?: string; target?: { requirement?: string } | null };

/** Home-screen banner telling the driver exactly what their new application still needs. */
export default function DriverApplicationNudge({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [nudge, setNudge] = useState<ApplicationNudge | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let active = true;
    const today = new Date().toISOString().slice(0, 10);
    try { if (window.localStorage.getItem("moovu:app-nudge-hidden") === today) { setTimeout(() => setHidden(true), 0); } } catch {}
    void (async () => {
      const { data } = await supabaseClient.auth.getSession();
      if (!data.session) return;
      const res = await fetch("/api/driver/onboarding", {
        headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store",
      }).catch(() => null);
      if (!res?.ok) return;
      const body = await res.json().catch(() => null);
      if (!active || !body || !("application" in body)) return;
      // Only the most recent review's correction targets are still relevant.
      const reviews = (body.reviews ?? []) as Review[];
      const latest = reviews[reviews.length - 1];
      const targets = latest?.target?.requirement ? [latest.target.requirement] : [];
      setNudge(applicationNudge(body.application, Array.from(new Set(targets))));
    })();
    return () => { active = false; };
  }, []);

  if (!nudge || hidden) return null;
  const warn = nudge.tone === "warning";
  const hideToday = () => {
    try { window.localStorage.setItem("moovu:app-nudge-hidden", new Date().toISOString().slice(0, 10)); } catch {}
    setHidden(true);
  };

  return (
    <section className={`mb-3 rounded-2xl border px-4 py-3 text-sm ${warn ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-100 bg-blue-50 text-blue-900"}`}>
      <div className="flex items-start gap-2">
        <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-black">{nudge.title}</p>
          <p className="mt-1">{nudge.body}</p>
          {nudge.missing.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {nudge.missing.slice(0, 8).map((m) => <li key={m}>{m}</li>)}
              {nudge.missing.length > 8 && <li>and {nudge.missing.length - 8} more</li>}
            </ul>
          )}
          <button type="button" className="moovu-btn moovu-btn-primary mt-3" onClick={() => onNavigate("/driver/onboarding")}>
            {nudge.action}
          </button>
        </div>
        <button type="button" aria-label="Hide for today" className="rounded-full p-1" onClick={hideToday}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
