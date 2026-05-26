import Link from "next/link";
import type { Metadata } from "next";
import { MOOVU_SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Driver Contact | MOOVU",
  description: "MOOVU driver support contact page for applications, subscriptions, commission payments, trips, and account help.",
};

const supportItems = [
  "Driver application and approval status",
  "Complete-profile and document questions",
  "Subscription POPs and expiry questions",
  "Commission balance, R100 lock, and settlement support",
  "Trip offers, OTP workflow, chat, cancellations, and no-show support",
  "Notification, login, GPS, and mobile app issues",
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
          <p className="legal-kicker">MOOVU Driver Help</p>
          <h1 className="legal-title">Contact Driver Support</h1>
          <p className="legal-meta">Support email: {MOOVU_SUPPORT_EMAIL}</p>
        </section>

        <div className="legal-body">
          <section className="legal-section">
            <h2>How drivers can get help</h2>
            <p>
              Email MOOVU with your full name, cellphone number, driver email, trip ID or payment
              reference if available, and a clear description of the issue.
            </p>
            <div className="legal-contact-block">
              <div>Email: <a href={`mailto:${MOOVU_SUPPORT_EMAIL}`}>{MOOVU_SUPPORT_EMAIL}</a></div>
              <div>
                <a
                  href={`mailto:${MOOVU_SUPPORT_EMAIL}?subject=${encodeURIComponent("MOOVU Driver Support")}`}
                  className="moovu-btn moovu-btn-primary mt-3 inline-flex"
                >
                  Email driver support
                </a>
              </div>
            </div>
          </section>

          <section className="legal-section">
            <h2>Driver support topics</h2>
            <ul>
              {supportItems.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section className="legal-section">
            <h2>Important safety note</h2>
            <p>
              For urgent personal safety emergencies, contact local emergency services first. Use
              MOOVU support for platform, trip, account, payment, or review follow-up.
            </p>
          </section>
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
