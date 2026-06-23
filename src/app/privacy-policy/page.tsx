import Link from "next/link";
import type { Metadata } from "next";
import { MOOVU_LEGAL_VERSION, MOOVU_SUPPORT_EMAIL, MOOVU_WEBSITE_URL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy | MOOVU Kasi Rides",
  description: "How MOOVU Kasi Rides collects, uses, protects, and shares rider, driver, admin, payment, location, and notification data.",
};

const COMPANY = "MOOVU Kasi Rides";

const sections = [
  {
    title: "1. Introduction",
    paragraphs: [
      `${COMPANY} is a South African ride-hailing platform that connects customers with approved independent drivers for local transport services. This Privacy Policy explains how MOOVU collects, uses, stores, shares, and protects personal information when you use the customer booking flow, driver portal, admin portal, website, mobile app, PWA, support channels, payment review flows, chat, trip sharing, and push notification services.`,
      "This policy is written for customers, drivers, driver applicants, administrators, support users, visitors, and any person who contacts MOOVU or is included in a MOOVU trip, payment, support, safety, or operational record.",
    ],
  },
  {
    title: "2. Personal Information We Collect",
    items: [
      "Identity and account information, including name, phone number, email address, authentication identifiers, account role, profile status, legal acceptance records, and login/session metadata.",
      "Customer trip information, including pickup and destination addresses, coordinates, ride option, route, fare, payment method, OTP workflow, trip status, cancellation reason, ratings, receipts, support requests, and trip history.",
      "Driver and applicant information, including contact details, profile completion, vehicle details, driver approval status, online availability, subscription status, payment proof uploads, commission records, earnings, settlement records, quality metrics, and driver account links.",
      "Location information, including customer-selected pickup/dropoff coordinates, driver online location, active trip location checks, distance calculations, route estimates, and location timestamps.",
      "Communications and safety data, including trip chat messages, support messages, customer-started safety audio recordings, operational notes, admin review notes, message read status, notification delivery logs, and related timestamps.",
      "Device and technical information, including app platform, browser or device type, FCM token, push subscription data, device identifier where available, service worker state, IP-derived diagnostics, logs, and error details.",
      "Payment and financial information used by MOOVU, including fares, receipts, payment review status, driver subscription payments, commission balances, proof-of-payment files, settlement references, and related audit records.",
    ],
  },
  {
    title: "3. How We Collect Information",
    items: [
      "Directly from you when you register, book a ride, apply as a driver, go online, upload proof of payment, contact support, accept terms, enable notifications, or use chat.",
      "Automatically through the app when you use maps, location tools, push notifications, trip workflow actions, realtime chat, OTP trip controls, or app diagnostics.",
      "From drivers, customers, administrators, and support staff when they create operational records, update trip status, review payments, handle disputes, or report safety concerns.",
      "From service providers such as Supabase, Vercel, Firebase, Google Maps, and other infrastructure providers that help operate MOOVU.",
    ],
  },
  {
    title: "4. Why We Use Personal Information",
    items: [
      "To create and secure customer, driver, and admin accounts.",
      "To verify driver applications, driver subscriptions, driver status, profile completion, and platform eligibility.",
      "To create bookings, calculate fares, assign ride requests, send trip offers, manage driver accept/decline actions, and complete trips.",
      "To operate OTP trip security, prevent wrong-trip starts, and keep the trip workflow accurate.",
      "To provide customer-driver chat for assigned trips and notify the correct participant about unread messages.",
      "To send important notifications about ride requests, driver acceptance, arrival, trip start, trip completion, cancellations, payment review, subscription, commission, and system events.",
      "To generate receipts, reports, driver earnings, commission records, subscription records, settlements, and admin dashboards.",
      "To investigate support queries, disputes, cancellations, no-shows, fraud, suspicious activity, technical errors, safety events, and policy violations.",
      "To improve dispatch accuracy, app reliability, mobile usability, payment operations, and customer/driver experience.",
      "To meet legal, tax, accounting, safety, security, and regulatory obligations.",
    ],
  },
  {
    title: "5. Location Information",
    paragraphs: [
      "MOOVU uses location data because ride-hailing cannot work properly without pickup, destination, route, distance, driver availability, and active trip context. Customers may type an address or use device location to set a pickup. Drivers use location while online so MOOVU can offer trips accurately and confirm workflow actions near pickup or destination where supported.",
      "Driver location is used for dispatch, trip offers, trip status accuracy, safety, support, and operational records. If a driver disables location or submits inaccurate location information, trip offers and workflow actions may not work correctly.",
      "MOOVU uses mapping providers such as Google Maps for geocoding, place search, distance, duration, and map display. Those providers may process mapping queries and technical data under their own terms and privacy notices.",
    ],
  },
  {
    title: "6. Push Notifications and Device Tokens",
    paragraphs: [
      "When you enable notifications, MOOVU stores a Firebase Cloud Messaging token or web push subscription so we can send important ride, chat, payment, driver, account, and admin alerts. Notifications may be sent while the app is open, in the background, or closed where supported by Android, iOS, browser, and device settings.",
      "You can disable notifications in your device settings or browser settings. If you disable notifications, MOOVU may still show in-app updates, but important ride or payment alerts may be delayed or missed.",
    ],
  },
  {
    title: "7. Chat, Support, Ratings, and Safety Records",
    paragraphs: [
      "MOOVU may store trip chat messages between the assigned customer and driver, message read state, support requests, ratings, complaints, incident notes, customer-started safety audio recordings, and admin review records. These records help complete trips, resolve disputes, support safety reviews, and investigate misuse.",
      "Safety audio recording only starts when the customer chooses to record during an eligible trip. MOOVU does not secretly record in the background. Recordings are linked to the relevant trip and should only be reviewed by authorized admin or support users when needed for safety or support handling.",
      "Do not send passwords, bank card numbers, government identity numbers, or unnecessary sensitive information in chat or support messages. MOOVU may restrict, review, or preserve communications where required for safety, fraud prevention, legal compliance, or dispute handling.",
    ],
  },
  {
    title: "8. How We Share Information",
    items: [
      "With the assigned customer and assigned driver so they can complete a trip, including relevant trip, contact, pickup, destination, fare, OTP workflow, chat, and status information.",
      "With approved administrators and support staff who need access for dispatch, payment review, driver approval, customer support, reporting, safety, and compliance.",
      "With infrastructure providers such as Supabase, Vercel, Firebase, Google Maps, hosting, storage, analytics, email, logging, and notification providers that process data on behalf of MOOVU.",
      "With payment, accounting, tax, legal, insurance, safety, fraud prevention, or regulatory parties where necessary and lawful.",
      "With law enforcement, regulators, courts, or other authorities if required by law, legal process, safety risk, fraud investigation, or protection of rights.",
    ],
    paragraphs: [
      "MOOVU does not sell personal information.",
      "MOOVU does not use advertising identifiers, cross-app tracking, or third-party advertising tracking to follow users across apps and websites owned by other companies. Operational location, trip, device token, and diagnostic data is used to provide MOOVU rides, safety, support, notifications, and platform operations.",
    ],
  },
  {
    title: "9. Legal Basis and POPIA-Style Rights",
    paragraphs: [
      "MOOVU processes personal information to provide the service, perform user agreements, protect legitimate business and safety interests, comply with legal obligations, and where needed, based on consent such as notification permission or location permission.",
      "Subject to applicable law, including South African privacy principles, you may request access to your personal information, correction of inaccurate information, deletion where legally possible, restriction or objection to certain processing, and information about how your data is used.",
      `You can start an account deletion request from the Account area in the MOOVU app, or email ${MOOVU_SUPPORT_EMAIL}. We may need to verify your identity before acting on the request. Some records must be retained for legal, accounting, fraud prevention, dispute, payment, receipt, or safety reasons.`,
    ],
  },
  {
    title: "10. Retention",
    paragraphs: [
      "MOOVU keeps account, trip, receipt, payment, commission, driver, support, legal acceptance, notification, chat, safety audio, and audit records for as long as needed to operate the platform, provide support, resolve disputes, detect fraud, satisfy tax/accounting obligations, enforce terms, and comply with law.",
      "When a deletion request is approved, MOOVU will delete, anonymize, archive, or restrict account data where reasonably possible. Trip, receipt, payment, commission, driver, safety, support, fraud-prevention, legal acceptance, and audit records may be retained where required for legal, tax, accounting, dispute, safety, or platform integrity reasons. Backup copies and logs may remain for a limited period as part of normal security and disaster recovery processes.",
    ],
  },
  {
    title: "11. Security",
    paragraphs: [
      "MOOVU uses authenticated sessions, role-based access, protected API routes, server-side checks, HTTPS, Supabase access controls, Firebase server credentials only on the server, OTP trip controls, protected payment review flows, and operational logging.",
      "No app, network, or database can be guaranteed perfectly secure. Users must protect their login details, keep devices secure, avoid sharing OTPs except with the assigned driver for the correct trip, and report suspicious activity quickly.",
    ],
  },
  {
    title: "12. International Processing",
    paragraphs: [
      "MOOVU uses cloud and infrastructure providers that may process or store data in South Africa or other countries. Where information is transferred internationally, MOOVU aims to use reputable providers and appropriate safeguards for platform operation, security, and support.",
    ],
  },
  {
    title: "13. Children and Minors",
    paragraphs: [
      "MOOVU is intended for users who can lawfully use ride-hailing services, create accounts, and enter platform agreements. Minors should only use MOOVU with appropriate permission and supervision where required by law. If you believe a minor has created an account without proper authority, contact MOOVU for review.",
    ],
  },
  {
    title: "14. Changes to This Policy",
    paragraphs: [
      "MOOVU may update this Privacy Policy as the platform, mobile apps, legal requirements, payment operations, safety features, or notification systems change. The latest version will be shown on this page. Continued use after an update means you accept the updated policy where allowed by law.",
    ],
  },
  {
    title: "15. Contact",
    paragraphs: [
      `For privacy, account, support, payment, driver, receipt, notification, or deletion questions, contact ${MOOVU_SUPPORT_EMAIL}.`,
    ],
  },
];

function sectionId(title: string) {
  return title
    .toLowerCase()
    .replace(/^\d+\.\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function sectionLabel(title: string) {
  return title.replace(/^\d+\.\s*/, "");
}

export default function PrivacyPolicyPage() {
  return (
    <main className="legal-screen">
      <div className="legal-container">
        <div className="legal-header">
          <Link href="/" className="legal-back">Back to MOOVU</Link>
          <div className="legal-badge">Privacy</div>
        </div>

        <section className="legal-hero" aria-labelledby="privacy-policy-title">
          <p className="legal-kicker">MOOVU Policies</p>
          <h1 className="legal-title" id="privacy-policy-title">Privacy Policy</h1>
          <p className="legal-meta">{COMPANY} | Last updated: {MOOVU_LEGAL_VERSION}</p>
        </section>

        <nav className="legal-toc" aria-label="Privacy Policy sections">
          {sections.map((section) => (
            <a href={`#${sectionId(section.title)}`} key={section.title}>
              {sectionLabel(section.title)}
            </a>
          ))}
        </nav>

        <div className="legal-body">
          {sections.map((section) => (
            <section className="legal-section" id={sectionId(section.title)} key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.items ? (
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          <section className="legal-section">
            <h2>MOOVU Contact Details</h2>
            <div className="legal-contact-block">
              <div><strong>{COMPANY}</strong></div>
              <div>Email: <a href={`mailto:${MOOVU_SUPPORT_EMAIL}`}>{MOOVU_SUPPORT_EMAIL}</a></div>
              <div>Website: <a href={MOOVU_WEBSITE_URL}>{MOOVU_WEBSITE_URL}</a></div>
            </div>
          </section>
        </div>

        <div className="legal-footer">
          <Link href="/terms">Terms of Service</Link>
          <span>|</span>
          <Link href="/contact">Contact</Link>
          <span>|</span>
          <Link href="/">Back to MOOVU</Link>
        </div>
      </div>
    </main>
  );
}
