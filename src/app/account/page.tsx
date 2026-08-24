"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CreditCard, FileText, Headphones, LogOut, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import CustomerBackHomeNav from "@/components/app-shell/CustomerBackHomeNav";
import CustomerProfileHeader from "@/components/customer/CustomerProfileHeader";
import CustomerSettingsRow from "@/components/customer/CustomerSettingsRow";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";

type CustomerProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
};

type AccountForm = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
};

export default function CustomerAccountPage() {
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [form, setForm] = useState<AccountForm>({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
  });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [roleMismatch, setRoleMismatch] = useState(false);

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

      const role = String(session.user.user_metadata?.role || session.user.app_metadata?.role || "").toLowerCase();
      if (role === "driver") {
        if (!cancelled) { setRoleMismatch(true); setLoading(false); }
        return;
      }

      const res = await fetch("/api/customer/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!cancelled) {
        if (res.ok && json?.ok) {
          const nextCustomer = json.customer as CustomerProfile;
          setCustomer(nextCustomer);
          setForm({
            first_name: nextCustomer.first_name ?? "",
            last_name: nextCustomer.last_name ?? "",
            email: nextCustomer.email ?? "",
            phone: nextCustomer.phone ?? "",
          });
        } else setMessage(json?.error || "Could not load your customer account.");
        setLoading(false);
      }
    }

    void loadCustomer();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveAccountDetails() {
    setSaving(true);
    setMessage(null);

    try {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!session?.access_token) {
        window.location.href = "/customer/auth?next=/account";
        return;
      }

      const res = await fetch("/api/customer/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMessage(json?.error || "Could not update your account details. Please try again.");
        return;
      }

      const nextCustomer = json.customer as CustomerProfile;
      setCustomer(nextCustomer);
      setForm({
        first_name: nextCustomer.first_name ?? "",
        last_name: nextCustomer.last_name ?? "",
        email: nextCustomer.email ?? form.email,
        phone: nextCustomer.phone ?? "",
      });
      setEditing(false);
      setMessage(json?.warning || "Account details updated.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    await supabaseClient.auth.signOut();
    window.location.href = "/";
  }

  async function signInAsCustomer() {
    await supabaseClient.auth.signOut();
    window.location.href = "/customer/auth?next=/account";
  }

  if (roleMismatch) {
    return (
      <main className="moovu-page min-h-screen pb-32 text-slate-950">
        <div className="moovu-shell max-w-4xl py-6">
          <CustomerBackHomeNav fallbackHref="/" />
          <section className="customer-role-page">
            <span>Driver account detected</span>
            <h1>This page is for MOOVU customers</h1>
            <p>Your Driver account remains unchanged. Continue to the Driver portal or explicitly sign in with a Customer account.</p>
            <div><Link href="https://driver.moovurides.co.za/driver" className="moovu-btn moovu-btn-primary">Open Driver portal</Link><button type="button" className="moovu-btn moovu-btn-secondary" onClick={signInAsCustomer}>Sign in as Customer</button></div>
          </section>
        </div>
        <CustomerBottomNav />
      </main>
    );
  }

  return (
    <main className="moovu-page min-h-screen pb-32 text-slate-950">
      {message && <CenteredMessageBox message={message} onClose={() => setMessage(null)} />}

      <div className="moovu-shell max-w-4xl space-y-5 py-6">
        <CustomerBackHomeNav fallbackHref="/book" />
        <CustomerProfileHeader
          name={`${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim() || "Customer"}
          email={customer?.email}
          phone={customer?.phone}
        />

        <section className="customer-settings-section">
          <div className="customer-settings-title"><span>Account</span><strong>Profile and security</strong></div>
          <CustomerSettingsRow icon={Pencil} label={editing ? "Close personal details" : "Personal details"} detail={loading ? "Loading your profile" : "Name and verified contact details"} onClick={() => setEditing((value) => !value)} />
          <CustomerSettingsRow href="/account/security" icon={ShieldCheck} label="Security" detail="Email and cellphone verification" />
          <CustomerSettingsRow href="/account/payment-methods" icon={CreditCard} label="Payment methods" detail="Cash/Transfer is currently available" />
          <CustomerSettingsRow href="/book" icon={Bell} label="Notifications" detail="Manage trip updates on this device" />
        </section>

        <section className="customer-settings-section">
          <div className="customer-settings-title"><span>Safety and support</span><strong>Help and legal</strong></div>
          <CustomerSettingsRow href="/contact" icon={ShieldCheck} label="Safety" detail="Ride safety and assistance" />
          <CustomerSettingsRow href="/contact" icon={Headphones} label="Contact MOOVU" detail="Support and ride assistance" />
          <CustomerSettingsRow href="/privacy-policy" icon={FileText} label="Privacy and terms" detail="How MOOVU protects your information" />
          <CustomerSettingsRow icon={LogOut} label="Log out" onClick={signOut} />
          <CustomerSettingsRow href="/account/delete" icon={Trash2} label="Delete account" detail="Permanently remove your account" danger />
        </section>

        {editing && (
          <section className="moovu-card p-5 sm:p-7">
            <div className="moovu-section-title">Edit profile</div>
            <h2 className="mt-2 text-2xl font-black">Account details</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Keep your name, email, and cellphone number up to date so drivers and MOOVU support can reach you when needed.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold text-slate-700">
                First name
                <input
                  className="moovu-input"
                  value={form.first_name}
                  onChange={(event) => setForm((value) => ({ ...value, first_name: event.target.value }))}
                  autoComplete="given-name"
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-slate-700">
                Surname
                <input
                  className="moovu-input"
                  value={form.last_name}
                  onChange={(event) => setForm((value) => ({ ...value, last_name: event.target.value }))}
                  autoComplete="family-name"
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-slate-700">
                Email address
                <input
                  className="moovu-input bg-slate-50"
                  type="email"
                  value={form.email}
                  autoComplete="email"
                  readOnly
                />
                <span className="text-xs font-semibold text-emerald-700">Verified contact</span>
              </label>
              <label className="grid gap-2 text-sm font-bold text-slate-700">
                Cellphone number
                <input
                  className="moovu-input bg-slate-50"
                  value={form.phone}
                  autoComplete="tel"
                  readOnly
                />
                <span className="text-xs font-semibold text-emerald-700">Verified contact</span>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button className="moovu-btn moovu-btn-primary" onClick={saveAccountDetails} disabled={saving}>
                {saving ? "Saving..." : "Save Account Details"}
              </button>
              <button
                className="moovu-btn moovu-btn-secondary"
                onClick={() => {
                  setForm({
                    first_name: customer?.first_name ?? "",
                    last_name: customer?.last_name ?? "",
                    email: customer?.email ?? "",
                    phone: customer?.phone ?? "",
                  });
                  setEditing(false);
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <Link className="moovu-btn moovu-btn-secondary" href="/account/security">
                Change email or cellphone
              </Link>
            </div>
          </section>
        )}

      </div>

      <CustomerBottomNav />
    </main>
  );
}
