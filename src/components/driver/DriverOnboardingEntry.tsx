"use client";

import { useEffect, useState } from "react";
import { FileCheck2 } from "lucide-react";
import { onboardingReminder } from "@/lib/drivers/onboardingReminder";
import { supabaseClient } from "@/lib/supabase/client";

type Application = { status: string; cycle: number } | null;

export default function DriverOnboardingEntry({ onNavigate }: { onNavigate: (path: string) => void }) {
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
  const entry = onboardingReminder(application?.status ?? null);
  if (!entry) return null;
  return <section className="driver-drawer-onboarding" aria-label="Driver application status">
    <div className="driver-drawer-onboarding-title"><FileCheck2 aria-hidden="true" /><strong>{entry.title}</strong></div>
    <p>{entry.description}</p>
    <button type="button" onClick={() => onNavigate("/driver/onboarding")}>{entry.action}</button>
  </section>;
}
