import Link from "next/link";
import type { Metadata } from "next";
import { MOOVU_LEGAL_VERSION, MOOVU_SUPPORT_EMAIL, MOOVU_WEBSITE_URL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Driver Privacy Policy | MOOVU",
  description: "Driver-focused privacy information for MOOVU driver applicants and approved drivers.",
};

const sections = [
  {
    title: "Driver information MOOVU collects",
    items: [
      "Account details such as name, cellphone number, email address, login identifiers, driver account link, and role.",
      "Application and verification details such as profile status, vehicle details, documents, admin review notes, approval status, and suspension or deletion records.",
      "Operational data such as online status, busy status, GPS location while online or on a trip, trip offers, accept or decline actions, arrival, OTP start and completion, no-show actions, and trip history.",
      "Financial records such as fares, driver earnings, MOOVU commission, R100 commission lock status, subscriptions, proof-of-payment uploads, settlements, receipts, payment references, and admin review outcomes.",
      "Device and notification data such as FCM tokens, web push subscriptions, platform type, app type, notification delivery logs, and in-app alert events.",
      "Support and communication data such as customer-driver chat for assigned trips, support messages, admin notes, safety reports, and dispute records.",
    ],
  },
  {
    title: "Why MOOVU uses driver data",
    items: [
      "To review driver applications and confirm whether a driver may operate on MOOVU.",
      "To match drivers to trip offers and keep dispatch, maps, navigation, and trip status accurate.",
      "To protect OTP trip security and reduce wrong-trip, false-arrival, or payment abuse.",
      "To calculate driver earnings, subscription status, commission owed, settlements, receipts, and payment reviews.",
      "To send important driver notifications about offers, trip updates, chat, commission, subscription, payment review, and account status.",
      "To investigate support queries, safety issues, cancellations, no-shows, payment proof issues, fraud, and policy violations.",
    ],
  },
  {
    title: "Location and trip data",
    paragraphs: [
      "MOOVU uses driver location while a driver is online, receiving offers, navigating to pickup, waiting at pickup, driving to a destination, or completing a trip. Location helps with dispatch accuracy, route display, support, and safety checks.",
      "If location permission is blocked, disabled, or inaccurate, the driver app may not offer trips correctly and some workflow actions may be delayed or reviewed.",
    ],
  },
  {
    title: "Sharing and access",
    paragraphs: [
      "MOOVU shares only the driver information needed to operate trips, support customers, review payments, and manage safety. Customers may see assigned driver details after a trip is accepted. Admin users may see driver application, trip, payment, subscription, commission, document, and support records for operational purposes.",
      "MOOVU does not sell driver personal information.",
      "MOOVU does not use advertising identifiers, cross-app tracking, or third-party advertising tracking to follow drivers across apps and websites owned by other companies. Driver GPS, token, trip, payment, and diagnostic data is used for MOOVU platform operations, safety, support, and notifications.",
    ],
  },
  {
    title: "Retention, safety, and driver rights",
    paragraphs: [
      "MOOVU keeps driver records for as long as needed for platform operation, legal compliance, accounting, tax, payment review, dispute handling, fraud prevention, and safety.",
      `Drivers can start an account deletion request from the Driver Account area, or contact ${MOOVU_SUPPORT_EMAIL} to ask about their data, request corrections, or ask for deletion where legally and operationally possible. Some records must be kept for receipts, payments, trips, commission, subscriptions, documents, safety, disputes, tax, accounting, or legal reasons.`,
    ],
  },
];

export default function DriverPrivacyPolicyPage() {
  return (
    <main className="legal-screen">
      <div className="legal-container">
        <div className="legal-header">
          <Link href="/driver" className="legal-back">Back to Driver Portal</Link>
          <div className="legal-badge">Driver Privacy</div>
        </div>

        <section className="legal-hero">
          <p className="legal-kicker">MOOVU Driver Policies</p>
          <h1 className="legal-title">Driver Privacy Policy</h1>
          <p className="legal-meta">Last updated: {MOOVU_LEGAL_VERSION}</p>
        </section>

        <div className="legal-body">
          {sections.map((section) => (
            <section className="legal-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.items ? (
                <ul>
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
            </section>
          ))}

          <section className="legal-section">
            <h2>Contact MOOVU</h2>
            <div className="legal-contact-block">
              <div>Email: <a href={`mailto:${MOOVU_SUPPORT_EMAIL}`}>{MOOVU_SUPPORT_EMAIL}</a></div>
              <div>Website: <a href={MOOVU_WEBSITE_URL}>{MOOVU_WEBSITE_URL}</a></div>
            </div>
          </section>
        </div>

        <div className="legal-footer">
          <Link href="/driver/terms">Driver Terms</Link>
          <span>|</span>
          <Link href="/driver/contact">Driver Contact</Link>
          <span>|</span>
          <Link href="/driver">Driver Portal</Link>
        </div>
      </div>
    </main>
  );
}
