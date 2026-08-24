"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, Menu, Navigation, Search } from "lucide-react";
import CustomerAppShell from "@/components/customer/CustomerAppShell";
import CustomerBottomSheet from "@/components/customer/CustomerBottomSheet";
import CustomerDrawer from "@/components/customer/CustomerDrawer";
import CustomerMapHome from "@/components/customer/CustomerMapHome";
import EnableNotificationsButton from "@/components/EnableNotificationsButton";
import { supabaseClient } from "@/lib/supabase/client";

export default function HomePage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [driverSession, setDriverSession] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!active) return;
      setLoggedIn(Boolean(session));
      const role = String(session?.user?.user_metadata?.role || session?.user?.app_metadata?.role || "").toLowerCase();
      setDriverSession(role === "driver");
      setCustomerName(String(session?.user?.user_metadata?.first_name || session?.user?.user_metadata?.name || ""));
      setChecking(false);
      if (session && role !== "driver") {
        const response = await fetch("/api/customer/me", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (active && response.ok && payload?.ok && payload.customer) {
          const fullName = `${payload.customer.first_name || ""} ${payload.customer.last_name || ""}`.trim();
          if (fullName) setCustomerName(fullName);
          setCustomerContact(payload.customer.phone || payload.customer.email || "");
        }
      }
    }
    void load();
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setLoggedIn(Boolean(session));
      setChecking(false);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  const bookingHref = useMemo(() => loggedIn && !driverSession ? "/book" : "/customer/auth?next=/book", [loggedIn, driverSession]);
  async function logout() { await supabaseClient.auth.signOut(); window.location.href = "/"; }

  return (
    <CustomerAppShell className="customer-home-screen">
      <CustomerMapHome />
      <div className="customer-home-topbar">
        <button type="button" className="customer-floating-icon" onClick={() => setDrawerOpen(true)} aria-label="Open menu"><Menu /></button>
        <div className="customer-home-brand"><span>MOOVU</span><strong>{loggedIn && customerName ? `Hi, ${customerName}` : "Kasi Rides"}</strong></div>
        <div className="customer-home-notification"><Bell aria-hidden="true" /><EnableNotificationsButton role="customer" variant="chip" /></div>
      </div>

      <CustomerBottomSheet>
        {driverSession ? (
          <div className="customer-role-mismatch">
            <span>Driver account detected</span>
            <h1>Choose where you want to continue</h1>
            <p>This customer home will not change your driver account or create a customer profile.</p>
            <div><Link href="https://driver.moovurides.co.za/driver" className="customer-sheet-primary">Open Driver portal</Link><Link href="/customer/auth?next=/book" className="customer-sheet-secondary">Sign in as Customer</Link></div>
          </div>
        ) : (
          <>
            <div className="customer-sheet-heading"><div><span>{loggedIn ? "Ready when you are" : "Welcome to MOOVU"}</span><h1>{loggedIn ? "Where to?" : "Your local ride starts here"}</h1></div><Navigation aria-hidden="true" /></div>
            <Link href={bookingHref} className="customer-where-to"><Search aria-hidden="true" /><span><strong>{loggedIn ? "Where are you going?" : "Start booking"}</strong><small>Pickup, destination and ride options</small></span></Link>
            {!loggedIn && !checking ? <Link href="/driver/apply" className="customer-become-driver">Become a Driver</Link> : null}
          </>
        )}
      </CustomerBottomSheet>
      <CustomerDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} loggedIn={loggedIn} name={customerName} contact={customerContact} onLogout={logout} />
    </CustomerAppShell>
  );
}
