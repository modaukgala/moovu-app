import Link from "next/link";
import type { Metadata } from "next";
import { MOOVU_LEGAL_VERSION, MOOVU_SUPPORT_EMAIL, MOOVU_WEBSITE_URL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service | MOOVU Kasi Rides",
  description: "Terms for MOOVU customers, drivers, payments, fares, OTP trip security, cancellations, subscriptions, commissions, and platform use.",
};

const COMPANY = "MOOVU Kasi Rides";

const sections = [
  {
    title: "1. Agreement to These Terms",
    paragraphs: [
      `These Terms of Service govern your access to and use of ${COMPANY}, including the website, customer booking experience, driver portal, admin portal, mobile app, PWA, support channels, trip chat, payment review flows, receipts, notifications, and related services.`,
      "By creating an account, booking a ride, applying as a driver, going online, accepting a trip, uploading payment proof, using chat, enabling notifications, or otherwise using MOOVU, you agree to these Terms and the Privacy Policy. If you do not agree, you must not use MOOVU.",
    ],
  },
  {
    title: "2. MOOVU Platform Role",
    paragraphs: [
      "MOOVU provides technology and operational tools that connect customers who request rides with approved independent drivers who choose whether to accept ride requests. Unless a separate written agreement says otherwise, drivers are independent service providers and are not employees, agents, or partners of MOOVU.",
      "MOOVU may support dispatch, payment review, receipts, driver subscriptions, commission records, customer support, quality controls, and safety workflows, but the transport service is provided by the assigned driver.",
    ],
  },
  {
    title: "3. Accounts and Eligibility",
    items: [
      "You must provide accurate, current, and complete account information.",
      "You must keep your login credentials, device, OTPs, and account secure.",
      "You may not create fake accounts, impersonate another person, share accounts without permission, or bypass role restrictions.",
      "MOOVU may verify, reject, suspend, restrict, or remove accounts if information is false, incomplete, unsafe, abusive, fraudulent, or non-compliant.",
      "Administrators may only use admin tools for authorized MOOVU operational purposes.",
    ],
  },
  {
    title: "4. Customer Responsibilities",
    items: [
      "Enter accurate pickup and destination details and confirm the correct ride option before booking.",
      "Be ready at the pickup location and keep your phone available for trip updates.",
      "Treat drivers, vehicles, admins, and other users respectfully.",
      "Use OTP codes only for the assigned trip and do not share them with anyone except the assigned driver at the correct workflow step.",
      "Pay the confirmed fare and any valid cancellation, no-show, or additional charge shown or confirmed by MOOVU.",
      "Do not request unsafe, unlawful, abusive, discriminatory, fraudulent, or impossible trips.",
    ],
  },
  {
    title: "5. Driver Responsibilities",
    items: [
      "Provide accurate identity, contact, vehicle, document, subscription, and payment information.",
      "Keep your vehicle roadworthy, safe, clean, legally compliant, and properly licensed or insured where required.",
      "Only go online when you are available, fit to drive, and ready to accept trips.",
      "Keep location services accurate while online and during active trips.",
      "Accept or decline trip offers honestly and promptly.",
      "Follow the MOOVU workflow: accept, arrive, verify OTP, start trip, complete trip, and handle cancellations correctly.",
      "Do not start a trip without the correct customer, correct vehicle, correct trip, and correct OTP.",
      "Pay required subscriptions, commission balances, and any platform amounts when due.",
      "Do not manipulate fares, locations, trip status, OTPs, receipts, payment proofs, commissions, or ratings.",
    ],
  },
  {
    title: "6. Bookings and Trip Offers",
    paragraphs: [
      "A booking is created when a customer submits a ride request and MOOVU records the trip. MOOVU may send that request to one or more eligible drivers based on availability, location, subscription status, driver status, quality signals, and operational rules.",
      "Receiving a trip offer does not guarantee the trip until the driver accepts and MOOVU confirms the assignment. MOOVU may re-offer, escalate, expire, cancel, or reassign trip offers to keep dispatch accurate.",
      "If only one eligible driver is online, MOOVU may keep re-offering the trip to that driver until the driver accepts, declines, goes offline, becomes ineligible, or the trip is cancelled. If multiple eligible drivers are online, MOOVU may offer to another driver after a short escalation period while preserving fair acceptance controls.",
    ],
  },
  {
    title: "7. Fares, Payments, Receipts, Subscriptions, and Commissions",
    paragraphs: [
      "MOOVU calculates fares using server-side pricing rules, ride option, distance, duration, route information, and applicable platform settings. Fare estimates may differ from final operational records if trip details, route, or administrative corrections change.",
      "MOOVU may support cash, proof-of-payment review, receipts, driver subscription payments, commission tracking, settlement records, and admin payment approval flows. Payment proof submission does not mean payment is approved until MOOVU has reviewed and confirmed it where review is required.",
      "Drivers are responsible for subscriptions, commission balances, and other platform amounts shown in the driver portal or confirmed by MOOVU. MOOVU may restrict driver access, online status, or withdrawals if required payments are overdue or suspicious.",
    ],
  },
  {
    title: "8. Cancellations, No-Shows, and Fees",
    paragraphs: [
      "Customers and drivers should cancel only when necessary and should provide an accurate reason. Cancellations after a driver accepts, arrives, or waits may result in a cancellation fee, driver payout, MOOVU platform amount, or admin review depending on the trip stage and policy in force.",
      "MOOVU may record cancellation fees, no-show fees, reasons, timestamps, responsible party, driver amount, and MOOVU amount for reporting, receipts, disputes, and admin records. Duplicate cancellation fee records should not be created for the same trip.",
      "Repeated cancellations, fake trips, no-shows, abusive use, or false reasons may lead to account review, limits, suspension, or removal.",
    ],
  },
  {
    title: "9. OTP Trip Security",
    paragraphs: [
      "MOOVU uses OTP trip controls to reduce wrong-passenger trips, wrong-driver trips, and workflow abuse. The customer must only share the OTP with the assigned driver for that trip. The driver must only enter the OTP at the correct trip stage.",
      "Attempts to bypass OTP checks, reuse OTPs, request OTPs outside the assigned trip, or mark false trip states may lead to account suspension, payment review, cancellation of earnings, legal action, or removal from MOOVU.",
    ],
  },
  {
    title: "10. Location, Maps, and Route Information",
    paragraphs: [
      "MOOVU uses pickup, destination, route, distance, duration, and driver location information to support booking, dispatch, trip workflow, fare calculation, support, and safety. Location and map results may be approximate and depend on device, GPS, network, mapping provider, and user input accuracy.",
      "Drivers must not falsify location or remain online while unavailable. Customers must check pickup and destination details before confirming a ride.",
    ],
  },
  {
    title: "11. Chat, Notifications, and Communications",
    paragraphs: [
      "MOOVU may provide trip chat between the assigned customer and driver. Chat must be used for trip-related communication only. Harassment, threats, spam, discrimination, fraud, payment manipulation, and abusive language are not allowed.",
      "MOOVU may send push notifications, in-app alerts, SMS, email, WhatsApp links, or other operational messages for ride requests, driver offers, acceptance, arrival, trip start, trip completion, cancellation, chat, payment, subscription, commission, receipt, account, safety, and admin events.",
      "You are responsible for keeping your device settings, notification permissions, internet connection, and contact details working. MOOVU is not responsible for missed alerts caused by disabled permissions, poor connectivity, device restrictions, outdated app versions, or third-party outages.",
    ],
  },
  {
    title: "12. Ratings, Quality, and Platform Integrity",
    paragraphs: [
      "MOOVU may use ratings, acceptance rates, missed offers, complaints, trip history, payment records, cancellations, driver quality metrics, and admin review outcomes to improve dispatch and protect platform integrity.",
      "MOOVU may investigate suspicious patterns, fake ratings, coordinated abuse, fraudulent trips, manipulated payment proofs, or attempts to interfere with dispatch, pricing, chat, notifications, or admin systems.",
    ],
  },
  {
    title: "13. Prohibited Conduct",
    items: [
      "Fraud, fake bookings, false driver applications, payment proof manipulation, fare manipulation, commission avoidance, or OTP abuse.",
      "Unsafe driving, unlawful transport, harassment, threats, hate speech, discrimination, violence, intimidation, or damage to property.",
      "Using MOOVU to transport illegal goods, commit unlawful acts, or place any user at risk.",
      "Scraping, reverse engineering, attacking, spamming, overloading, bypassing, or interfering with MOOVU systems.",
      "Accessing or attempting to access another user account, driver profile, trip, receipt, payment record, admin area, API, or database.",
      "Uploading malicious files, false documents, misleading payment proof, or content that violates another person's rights.",
    ],
  },
  {
    title: "14. Suspension, Restriction, and Termination",
    paragraphs: [
      "MOOVU may suspend, restrict, deactivate, or terminate access if a user violates these Terms, creates safety risk, provides false information, abuses the platform, fails to pay required amounts, receives repeated complaints, manipulates trip workflows, or creates legal, payment, or operational risk.",
      "MOOVU may also pause or restrict features during investigations, maintenance, system outages, payment reviews, driver verification, security incidents, or legal requests.",
    ],
  },
  {
    title: "15. Disputes and Support",
    paragraphs: [
      `For trip, payment, receipt, driver, cancellation, account, safety, or technical disputes, contact ${MOOVU_SUPPORT_EMAIL} as soon as possible with the trip reference, screenshots where relevant, and a clear description of the issue.`,
      "MOOVU may use trip records, location records, chat, receipts, payment proof, admin notes, notification logs, and user history to investigate and make operational decisions.",
    ],
  },
  {
    title: "16. Disclaimers",
    paragraphs: [
      "MOOVU aims to provide reliable technology, but the platform may be affected by network failures, GPS errors, mapping provider issues, Firebase or push notification delays, Supabase or hosting outages, device restrictions, browser limitations, driver availability, traffic, weather, road closures, or other conditions outside MOOVU's reasonable control.",
      "MOOVU does not guarantee that a driver will always be available, that a trip offer will always be accepted, that every notification will be delivered instantly, or that route estimates will always match real-world conditions.",
    ],
  },
  {
    title: "17. Limitation of Liability",
    paragraphs: [
      "To the maximum extent allowed by law, MOOVU is not liable for indirect, incidental, special, consequential, punitive, or loss-of-profit damages, or for losses caused by user misconduct, third-party services, network failures, inaccurate user information, unsafe conduct, missed notifications, or events outside MOOVU's reasonable control.",
      "Nothing in these Terms limits liability that cannot legally be limited under applicable law.",
    ],
  },
  {
    title: "18. Changes to MOOVU or These Terms",
    paragraphs: [
      "MOOVU may update features, prices, commission settings, subscriptions, dispatch logic, cancellation rules, payment processes, safety tools, notification systems, or these Terms. The latest version will be posted on this page. Continued use after an update means you accept the updated Terms where allowed by law.",
    ],
  },
  {
    title: "19. Governing Context",
    paragraphs: [
      "MOOVU operates for South African users and local ride-hailing operations. These Terms are intended to align with South African consumer, privacy, transport, payment, and general legal principles, subject to the specific laws and facts that apply to a dispute.",
    ],
  },
  {
    title: "20. Contact",
    paragraphs: [
      `For terms, account, driver, trip, payment, receipt, privacy, or support questions, contact ${MOOVU_SUPPORT_EMAIL}.`,
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

export default function TermsPage() {
  return (
    <main className="legal-screen">
      <div className="legal-container">
        <div className="legal-header">
          <Link href="/" className="legal-back">Back to MOOVU</Link>
          <div className="legal-badge">Terms</div>
        </div>

        <section className="legal-hero" aria-labelledby="terms-title">
          <p className="legal-kicker">MOOVU Policies</p>
          <h1 className="legal-title" id="terms-title">Terms of Service</h1>
          <p className="legal-meta">{COMPANY} | Last updated: {MOOVU_LEGAL_VERSION}</p>
        </section>

        <nav className="legal-toc" aria-label="Terms of Service sections">
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
          <Link href="/privacy-policy">Privacy Policy</Link>
          <span>|</span>
          <Link href="/contact">Contact</Link>
          <span>|</span>
          <Link href="/">Back to MOOVU</Link>
        </div>
      </div>
    </main>
  );
}
