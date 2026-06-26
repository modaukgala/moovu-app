"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type DriverProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string | null;
  subscription_status?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_registration?: string | null;
};

export default function DriverAccountPage() {
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDriver() {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!session) {
        window.location.href = "/driver/login?next=/driver/account";
        return;
      }

      const res = await fetch("/api/driver/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!cancelled) {
        if (res.ok && json?.ok) setDriver(json.driver);
        else setMessage(json?.error || "Could not load your driver account.");
        setLoading(false);
      }
    }

    void loadDriver();
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    await supabaseClient.auth.signOut({ scope: "local" });
    window.location.href = "/driver/login";
  }

  return (
    <main className="moovu-page min-h-screen pb-32 text-slate-950">
      {message && <CenteredMessageBox message={message} onClose={() => setMessage(null)} />}

      <div className="moovu-shell max-w-4xl space-y-5 py-6">
        <section className="moovu-card p-5 sm:p-7">
          <div className="moovu-section-title">Driver account</div>
          <h1 className="mt-2 text-3xl font-black">Account and privacy</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Manage your MOOVU Driver account, profile, support links, and account deletion.
          </p>
        </section>

        <section className="moovu-card p-5 sm:p-7">
          {loading ? (
            <p className="text-sm font-semibold text-slate-600">Loading driver account...</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Info label="Driver" value={`${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver"} />
              <Info label="Cellphone" value={driver?.phone || "Not captured"} />
              <Info label="Driver status" value={driver?.status || "pending"} />
              <Info label="Subscription" value={driver?.subscription_status || "inactive"} />
              <Info
                label="Vehicle"
                value={`${driver?.vehicle_make ?? ""} ${driver?.vehicle_model ?? ""}`.trim() || "Not captured"}
              />
              <Info label="Number plate" value={driver?.vehicle_registration || "Not captured"} />
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="moovu-btn moovu-btn-secondary" href="/driver/complete-profile">Complete profile</Link>
            <Link className="moovu-btn moovu-btn-secondary" href="/driver/trip-offers">Trip offers received</Link>
            <Link className="moovu-btn moovu-btn-secondary" href="/driver/privacy-policy">Driver Privacy</Link>
            <Link className="moovu-btn moovu-btn-secondary" href="/driver/terms">Driver Terms</Link>
            <Link className="moovu-btn moovu-btn-secondary" href="/driver/contact">Contact</Link>
            <button className="moovu-btn moovu-btn-secondary" onClick={signOut}>Logout</button>
          </div>
        </section>

        <section className="moovu-card border border-red-100 bg-red-50/50 p-5 sm:p-7">
          <div className="moovu-section-title text-red-700">Delete account</div>
          <h2 className="mt-2 text-2xl font-black">Delete Account</h2>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            Permanently delete your driver account from inside the app. MOOVU removes profile, vehicle, and document
            data where permitted, while retaining legally required trip, receipt, tax, fraud-prevention, and safety records.
          </p>
          <Link href="/driver/account/delete" className="moovu-btn mt-5 bg-red-600 text-white">
            Delete Account
          </Link>
        </section>
      </div>

      <DriverBottomNav />
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-slate-50 p-4">
      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black text-slate-950">{value}</div>
    </div>
  );
}
