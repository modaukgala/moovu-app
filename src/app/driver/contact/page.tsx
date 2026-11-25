import Link from "next/link";
import type { Metadata } from "next";
import WhatsAppSupportButton from "@/components/support/WhatsAppSupportButton";

export const metadata: Metadata = {
  title: "Driver Contact | MOOVU",
  description: "MOOVU driver support contact page for applications, subscriptions, commission payments, trips, and account help.",
};

const supportItems = [
  "Driver application and approval status",
  "Complete-profile and document questions",
  "Commission, payments and payouts",
  "Trip offers, start and end codes, cancellations",
  "Notifications, login, location and app problems",
];

export default function DriverContactPage() {
  return (
    <main className="legal-screen">
      <div className="legal-container">
        <div className="legal-header">
          <Link href="/driver" className="legal-back">Back to Driver Portal</Link>
          <div className="legal-badge">Driver Support</div>
        </div>

        <section className="legal-hero">
          <h1 className="legal-title">Driver help</h1>
          <p className="legal-meta">Message us on WhatsApp. Messages only, no calls.</p>
        </section>

        <div className="legal-body" style={{ display: "grid", gap: 16 }}>
          <WhatsAppSupportButton topic="driver" />
          <h2 style={{ margin: "8px 0 0", fontSize: 16 }}>We can help with</h2>
          <ul>
            {supportItems.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p className="legal-meta">In an emergency, call 10111 or 112 first.</p>
        </div>

        <div className="legal-footer">
          <Link href="/driver/privacy-policy">Driver Privacy</Link>
          <span>|</span>
          <Link href="/driver/terms">Driver Terms</Link>
          <span>|</span>
          <Link href="/driver">Driver Portal</Link>
        </div>
      </div>
    </main>
  );
}
