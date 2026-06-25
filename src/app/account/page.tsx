"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type CustomerProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string | null;
};

export default function CustomerAccountPage() {
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCustomer() {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!session) {
        window.location.href = "/customer/auth?next=/account";
        return;
      }

      const res = await fetch("/api/customer/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!cancelled) {
        if (res.ok && json?.ok) setCustomer(json.customer);
        else setMessage(json?.error || "Could not load your customer account.");
        setLoading(false);
      }
    }

    void loadCustomer();
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    await supabaseClient.auth.signOut();
    window.location.href = "/";
  }

  return (
    <main className="moovu-page min-h-screen pb-32 text-slate-950">
      {message && <CenteredMessageBox message={message} onClose={() => setMessage(null)} />}

      <div className="moovu-shell max-w-4xl space-y-5 py-6">
        <section className="moovu-card p-5 sm:p-7">
          <div className="moovu-section-title">Customer account</div>
          <h1 className="mt-2 text-3xl font-black">Account and privacy</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Manage your MOOVU customer account, legal links, and account deletion.
          </p>
        </section>

        <section className="moovu-card p-5 sm:p-7">
          {loading ? (
            <p className="text-sm font-semibold text-slate-600">Loading account...</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Info label="Name" value={`${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim() || "Customer"} />
              <Info label="Cellphone" value={customer?.phone || "Not captured"} />
              <Info label="Status" value={customer?.status || "active"} />
              <Info label="Support" value="admin@moovurides.co.za" />
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="moovu-btn moovu-btn-secondary" href="/privacy-policy">Privacy Policy</Link>
            <Link className="moovu-btn moovu-btn-secondary" href="/terms">Terms</Link>
            <Link className="moovu-btn moovu-btn-secondary" href="/contact">Contact</Link>
            <button className="moovu-btn moovu-btn-secondary" onClick={signOut}>Logout</button>
          </div>
        </section>

        <section className="moovu-card border border-red-100 bg-red-50/50 p-5 sm:p-7">
          <div className="moovu-section-title text-red-700">Delete account</div>
          <h2 className="mt-2 text-2xl font-black">Delete Account</h2>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            Permanently delete your customer account from inside the app. MOOVU removes profile data and anonymizes retained
            trip, receipt, tax, fraud-prevention, and safety records where legally required.
          </p>
          <Link href="/account/delete" className="moovu-btn mt-5 bg-red-600 text-white">
            Delete Account
          </Link>
        </section>
      </div>

      <CustomerBottomNav />
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
