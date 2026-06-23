import Link from "next/link";
import type { Metadata } from "next";
import { MOOVU_LEGAL_VERSION, MOOVU_SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Driver Terms and Conditions | MOOVU",
  description: "Driver terms of use for MOOVU driver applicants and approved drivers.",
};

const sections = [
  {
    title: "Driver access and approval",
    items: [
      "Drivers must apply with accurate personal, contact, vehicle, and document information.",
      "MOOVU may approve, reject, suspend, deactivate, or delete an application or driver profile after review.",
      "Approval does not guarantee trip volume, income, or permanent access to the platform.",
      "Drivers must keep their profile, vehicle, and contact details accurate and up to date.",
    ],
  },
  {
    title: "Driver responsibilities",
    items: [
      "Only go online when available, fit to drive, subscribed where required, and ready to accept trips.",
      "Use accurate GPS/location and do not manipulate location, trip status, fares, OTPs, payment proof, subscriptions, or commission balances.",
      "Accept or decline trip offers honestly and follow the app workflow: accept, drive to pickup, arrive, verify OTP, start, drive to destination, and complete.",
      "Treat customers, admins, and support staff professionally and safely.",
      "Do not share driver login details or allow another person to operate under your driver account.",
    ],
  },
  {
    title: "Subscriptions, commission, and payments",
    paragraphs: [
      "Driver subscription payments cover access from the current approved payment date for the selected period. Missed unpaid months are not counted backward into the new paid period unless MOOVU separately confirms a correction.",
      "Drivers are responsible for MOOVU commission balances, subscription payments, payment references, proof-of-payment uploads, and any admin review notes shown in the driver portal.",
      "A driver may be blocked from going online when commission owed reaches the configured lock limit or when subscription/profile requirements are not met.",
    ],
  },
  {
    title: "Trips, OTPs, chat, and safety",
    items: [
      "Drivers must not start a trip without the correct passenger and correct start OTP.",
      "Drivers must not complete a trip dishonestly or misuse end OTP, no-show, cancellation, or support tools.",
      "Chat is for assigned trip communication only and must not be used for harassment, fraud, threats, or off-platform payment pressure.",
      "MOOVU may review trip data, location records, chat, payment records, and admin notes when investigating disputes or safety concerns.",
    ],
  },
  {
    title: "Suspension and removal",
    paragraphs: [
      "MOOVU may suspend or remove driver access for false information, unsafe conduct, missed payment duties, subscription issues, repeated complaints, abuse, fraud, OTP misuse, payment proof manipulation, or breach of these terms.",
      "A suspended or inactive driver may still be able to log in to view account status, payments, and support information, but may not be able to go online or accept trips.",
      "Drivers may request account deletion from the Driver Account area. MOOVU may retain required application, document, trip, receipt, payment, commission, subscription, tax, accounting, dispute, safety, fraud-prevention, and legal records before deleting or anonymizing remaining driver account data.",
    ],
  },
  {
    title: "Support",
    paragraphs: [
      `For driver support, application review, subscription, commission, receipt, trip, notification, or account questions, contact ${MOOVU_SUPPORT_EMAIL}.`,
    ],
  },
];

export default function DriverTermsPage() {
  return (
    <main className="legal-screen">
      <div className="legal-container">
        <div className="legal-header">
          <Link href="/driver" className="legal-back">Back to Driver Portal</Link>
          <div className="legal-badge">Driver Terms</div>
        </div>

        <section className="legal-hero">
          <p className="legal-kicker">MOOVU Driver Policies</p>
          <h1 className="legal-title">Driver Terms and Conditions</h1>
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
        </div>

        <div className="legal-footer">
          <Link href="/driver/privacy-policy">Driver Privacy</Link>
          <span>|</span>
          <Link href="/driver/contact">Driver Contact</Link>
          <span>|</span>
          <Link href="/driver">Driver Portal</Link>
        </div>
      </div>
    </main>
  );
}
