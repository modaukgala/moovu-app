"use client";

import { useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type Application = { status: string; cycle: number } | null;

function entryFor(application: Application) {
  if (!application) return { title: "Complete your updated Driver profile", action: "Start onboarding" };
  if (application.status === "DRAFT" || application.status === "CORRECTION_REQUESTED") return { title: "Your Driver application needs your input", action: "Continue application" };
  if (["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"].includes(application.status)) return { title: "Your Driver application is under review", action: "View application" };
  if (application.status === "REJECTED") return { title: "Your Driver application needs an Admin decision before re-application", action: "View review" };
  return { title: "Your Driver onboarding is current", action: "View application" };
}

export default function DriverOnboardingEntry() {
  const [application, setApplication] = useState<Application>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabaseClient.auth.getSession();
      if (!data.session) return;
      const response = await fetch("/api/driver/onboarding", {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: "no-store",
      }).catch(() => null);
      if (!response?.ok) return;
      const body = await response.json().catch(() => null);
      if (active && body && "application" in body) {
        setApplication(body.application);
        setAvailable(true);
      }
    })();
    return () => { active = false; };
  }, []);

  if (!available) return null;
  const entry = entryFor(application);
  return <div className="mx-auto my-3 max-w-6xl rounded-xl border bg-white p-4">
    <p className="font-semibold">{entry.title}</p>
    <a className="mt-2 inline-block font-semibold underline" href="/driver/onboarding">{entry.action}</a>
    <p className="mt-1 text-sm">Your current Driver account and work access remain available while Phase 6 enforcement is off.</p>
  </div>;
}
