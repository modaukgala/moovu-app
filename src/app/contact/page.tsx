import Link from "next/link";
import type { Metadata } from "next";
import { MOOVU_SUPPORT_EMAIL, MOOVU_WEBSITE_URL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Contact MOOVU Kasi Rides",
  description: "Contact MOOVU support for bookings, driver support, admin, business, privacy, and safety queries.",
};

const COMPANY = "MOOVU Kasi Rides";

const contactCards = [
  {
    label: "Customer support",
    title: "Bookings, receipts, accounts, and trip help",
    subject: "Customer Support",
  },
  {
    label: "Privacy and safety",
    title: "Data requests, safety concerns, and policy questions",
    subject: "Privacy or Safety Request",
  },
  {
    label: "Driver support",
    title: "Applications, driver portal, trips, subscriptions, and payments",
    subject: "Driver Support",
  },
  {
    label: "Admin and business",
    title: "Operations, partnerships, reporting, and business support",
    subject: "Business Support",
  },
] as const;

export default function ContactPage() {
  return (
    <main className="legal-screen">
      <div className="legal-container">
        <div className="legal-header">
          <Link href="/" className="legal-back">Back to MOOVU</Link>
          <div className="legal-badge">Support</div>
        </div>

        <section className="legal-hero" aria-labelledby="contact-title">
          <p className="legal-kicker">MOOVU Help</p>
          <h1 className="legal-title" id="contact-title">Help and support</h1>
          <p className="legal-meta">Need help with a ride or your account? Email us below.</p>
        </section>

        <nav className="legal-toc legal-toc-compact" aria-label="MOOVU legal pages">
          <a href={`mailto:${MOOVU_SUPPORT_EMAIL}?subject=${encodeURIComponent("MOOVU Support")}`}>
            Email Support
          </a>
          <Link href="/privacy-policy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </nav>

        <div className="legal-body">
          <div className="contact-cards">
            {contactCards.map((card) => (
              <div key={card.label} className="contact-card">
                <div className="contact-card-icon">MO</div>
                <div>
                  <div className="contact-card-label">{card.label}</div>
                  <a
                    href={`mailto:${MOOVU_SUPPORT_EMAIL}?subject=${encodeURIComponent(card.subject)}`}
                    className="contact-card-value"
                  >
                    {MOOVU_SUPPORT_EMAIL}
                  </a>
                  <p className="contact-card-desc">{card.title}</p>
                </div>
              </div>
            ))}
          </div>

          <section className="legal-section">
            <h2>How to get help</h2>
            <p>
              Email MOOVU with your name, cellphone number, trip ID if available, and a clear
              description of the issue. For urgent personal safety emergencies, contact local
              emergency services first.
            </p>
            <div className="legal-contact-block">
              <div><strong>{COMPANY}</strong></div>
              <div>Email: <a href={`mailto:${MOOVU_SUPPORT_EMAIL}`}>{MOOVU_SUPPORT_EMAIL}</a></div>
              <div>Website: <a href={MOOVU_WEBSITE_URL}>{MOOVU_WEBSITE_URL}</a></div>
            </div>
          </section>

          <section className="legal-section">
            <h2>Legal and data requests</h2>
            <p>
              For privacy requests, data deletion questions, payment proof issues, or terms questions,
              use the same support email and include a relevant subject line.
            </p>
          </section>
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
