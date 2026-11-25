import Link from "next/link";
import type { Metadata } from "next";
import WhatsAppSupportButton from "@/components/support/WhatsAppSupportButton";

export const metadata: Metadata = {
  title: "Contact MOOVU Kasi Rides",
  description: "Contact MOOVU support for bookings, driver support, admin, business, privacy, and safety queries.",
};

export default function ContactPage() {
  return (
    <main className="legal-screen">
      <div className="legal-container">
        <div className="legal-header">
          <Link href="/" className="legal-back">Back to MOOVU</Link>
          <div className="legal-badge">Support</div>
        </div>

        <section className="legal-hero" aria-labelledby="contact-title">
          <h1 className="legal-title" id="contact-title">How can we help?</h1>
          <p className="legal-meta">Message us on WhatsApp. Messages only, no calls.</p>
        </section>

        <div className="legal-body" style={{ display: "grid", gap: 16 }}>
          <WhatsAppSupportButton topic="customer" />
          <h2 style={{ margin: "8px 0 0", fontSize: 16 }}>Common questions</h2>
          <nav className="moovu-help-list" aria-label="Common questions">
            <a href="/api/support/whatsapp?topic=lost" target="_blank" rel="noopener noreferrer">I left something in the car</a>
            <a href="/api/support/whatsapp?topic=fare" target="_blank" rel="noopener noreferrer">My fare looks wrong</a>
            <a href="/api/support/whatsapp?topic=card" target="_blank" rel="noopener noreferrer">I need help paying by card</a>
            <a href="/api/support/whatsapp?topic=safety" target="_blank" rel="noopener noreferrer">I feel unsafe</a>
            <a href="/api/support/whatsapp?topic=driver" target="_blank" rel="noopener noreferrer">I&apos;m a driver and need help</a>
          </nav>
          <p className="legal-meta">In an emergency, call 10111 or 112 first.</p>
        </div>

        <div className="legal-footer">
          <Link href="/privacy-policy">Privacy Policy</Link>
          <span>|</span>
          <Link href="/terms">Terms of Service</Link>
          <span>|</span>
          <Link href="/">Back to MOOVU</Link>
        </div>
      </div>
    </main>
  );
}
