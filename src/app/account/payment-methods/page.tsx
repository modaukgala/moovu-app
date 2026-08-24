"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Banknote, CreditCard, LockKeyhole, ReceiptText, Route } from "lucide-react";
import CustomerBackHomeNav from "@/components/app-shell/CustomerBackHomeNav";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import { supabaseClient } from "@/lib/supabase/client";

export default function CustomerPaymentMethodsPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void supabaseClient.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) { window.location.href = "/customer/auth?next=/account/payment-methods"; return; }
      setReady(true);
    });
    return () => { active = false; };
  }, []);
  return (
    <main className="moovu-app-screen">
      <div className="moovu-app-container customer-payment-page">
        <CustomerBackHomeNav fallbackHref="/account" />
        <header className="customer-payment-header">
          <span>MOOVU Customer</span>
          <h1>Payment methods</h1>
          <p>Simple, transparent payment for every MOOVU ride.</p>
        </header>

        <section className="customer-payment-hero" aria-busy={!ready}>
          <div className="customer-payment-hero-icon"><Banknote aria-hidden="true" /></div>
          <div>
            <span>Current payment method</span>
            <h2>Cash / Transfer</h2>
            <p>Pay the final trip amount shown in the app after your ride.</p>
          </div>
          <em><BadgeCheck aria-hidden="true" /> Default</em>
        </section>

        <section className="customer-payment-section" aria-labelledby="available-payment-title">
          <div className="customer-payment-section-heading">
            <span>Available now</span>
            <h2 id="available-payment-title">Your payment options</h2>
          </div>
          <div className="customer-payment-list" aria-busy={!ready}>
            <div className="customer-payment-row is-active">
              <span className="customer-payment-icon"><Banknote aria-hidden="true" /></span>
              <span><strong>Cash / Transfer</strong><small>Pay the final fare directly for your completed trip.</small></span>
              <em>Ready</em>
            </div>
            <div className="customer-payment-row is-muted">
              <span className="customer-payment-icon"><CreditCard aria-hidden="true" /></span>
              <span><strong>Online card payments</strong><small>Secure in-app card payments are being prepared.</small></span>
              <em>Coming soon</em>
            </div>
          </div>
        </section>

        <section className="customer-payment-section" aria-labelledby="payment-flow-title">
          <div className="customer-payment-section-heading">
            <span>Fare transparency</span>
            <h2 id="payment-flow-title">How payment works</h2>
          </div>
          <div className="customer-payment-flow">
            <div><Route aria-hidden="true" /><span><strong>See your estimate</strong><small>Your fare estimate appears before you confirm the ride.</small></span></div>
            <div><Banknote aria-hidden="true" /><span><strong>Confirm the final fare</strong><small>The completed trip shows the final amount based on the journey.</small></span></div>
            <div><ReceiptText aria-hidden="true" /><span><strong>Keep your receipt</strong><small>Your trip receipt remains available from Trip history.</small></span></div>
          </div>
        </section>

        <div className="customer-payment-note">
          <LockKeyhole aria-hidden="true" />
          <p>MOOVU will never ask you to save card details until secure online payments are officially available in the app.</p>
        </div>

        <div className="customer-payment-actions">
          <Link href="/book" className="moovu-btn moovu-btn-primary">Book a ride</Link>
          <Link href="/contact" className="moovu-btn moovu-btn-secondary">Payment help</Link>
        </div>
      </div>
      <CustomerBottomNav />
    </main>
  );
}
