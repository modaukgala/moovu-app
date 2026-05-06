import Link from "next/link";
import type { Metadata } from "next";
import { MOOVU_LEGAL_VERSION, MOOVU_SUPPORT_EMAIL, MOOVU_WEBSITE_URL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy | MOOVU Kasi Rides",
  description: "How MOOVU Kasi Rides collects, uses, protects, and shares rider and driver data.",
};

const COMPANY = "MOOVU Kasi Rides";

export default function PrivacyPolicyPage() {
  return (
    <main className="legal-screen">
      <div className="legal-container">
        <div className="legal-header">
          <Link href="/" className="legal-back">Back to MOOVU</Link>
          <div className="legal-badge">Privacy</div>
        </div>

        <h1 className="legal-title">Privacy Policy</h1>
        <p className="legal-meta">{COMPANY} | Last updated: {MOOVU_LEGAL_VERSION}</p>

        <div className="legal-body">
          <section className="legal-section">
            <h2>1. Who we are</h2>
            <p>
              {COMPANY} is a local ride-hailing platform that connects customers with approved
              drivers for trips in South Africa. This policy explains how MOOVU collects, uses,
              stores, and protects personal information in the customer app, driver portal, admin
              portal, and installable PWA.
            </p>
            <p>
              Contact us at <a href={`mailto:${MOOVU_SUPPORT_EMAIL}`}>{MOOVU_SUPPORT_EMAIL}</a>.
            </p>
          </section>

          <section className="legal-section">
            <h2>2. Information we collect</h2>
            <ul>
              <li>Account details, including name, phone number, authentication details, and account status.</li>
              <li>Customer pickup, destination, route, trip status, trip history, support, rating, and receipt data.</li>
              <li>Driver profile details, vehicle details, approval status, GPS availability, trip workflow, earnings, commission, subscription, and payment proof data.</li>
              <li>Location data used to set pickups, route trips, show nearby drivers, and support driver availability while the app is in use.</li>
              <li>Payment proof files, review status, receipts, timestamps, and operational audit records.</li>
              <li>Push notification subscription tokens, device/browser data, and app diagnostics needed to deliver ride and payment alerts.</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>3. How we use information</h2>
            <ul>
              <li>To create accounts and verify customers, drivers, and administrators.</li>
              <li>To calculate fares, create bookings, assign trips, track ride progress, and generate receipts.</li>
              <li>To protect trips with OTP security before start and during workflow updates.</li>
              <li>To review driver applications, subscriptions, commissions, settlements, and payment proofs.</li>
              <li>To send important ride, driver, payment, receipt, and account notifications.</li>
              <li>To investigate support issues, safety concerns, fraud, abuse, and operational disputes.</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>4. Location data</h2>
            <p>
              MOOVU uses location data to help customers set pickups and to help drivers save current
              GPS availability for dispatch and active trips. Customers can type an address instead
              of using device location. Driver location is used for operational dispatch and trip
              workflow while the driver is using the portal.
            </p>
            <p>
              We use mapping services such as Google Maps to geocode addresses, calculate distance,
              estimate duration, and display maps.
            </p>
          </section>

          <section className="legal-section">
            <h2>5. Sharing information</h2>
            <p>We share information only when needed to operate MOOVU or meet legal obligations.</p>
            <ul>
              <li>Customers and assigned drivers see relevant trip details needed to complete a ride.</li>
              <li>Approved administrators can access operational records for support, dispatch, payments, and compliance.</li>
              <li>Supabase, Vercel, Google Maps, and push notification services process data as platform providers.</li>
              <li>We may disclose information if required by law, safety investigations, or lawful requests.</li>
            </ul>
            <p>MOOVU does not sell personal information.</p>
          </section>

          <section className="legal-section">
            <h2>6. Retention and deletion</h2>
            <p>
              We keep account, trip, receipt, payment, and operational data for as long as needed to
              provide the service, resolve disputes, meet tax/accounting requirements, and comply with
              applicable law. You may request access, correction, or deletion by emailing
              {" "}<a href={`mailto:${MOOVU_SUPPORT_EMAIL}`}>{MOOVU_SUPPORT_EMAIL}</a>. Some records may
              need to be retained where required for legal, financial, or safety reasons.
            </p>
          </section>

          <section className="legal-section">
            <h2>7. Security</h2>
            <p>
              MOOVU uses authenticated access, server-side fare calculation, role checks, protected
              payment review flows, OTP trip security, and encrypted HTTPS connections. No system is
              perfect, so users should protect passwords and report suspicious activity quickly.
            </p>
          </section>

          <section className="legal-section">
            <h2>8. Children and minors</h2>
            <p>
              MOOVU is intended for users who can lawfully use ride-hailing services and create an
              account. We do not knowingly collect data from children. If a minor has created an
              account without proper authority, contact us for review.
            </p>
          </section>

          <section className="legal-section">
            <h2>9. Your rights</h2>
            <p>
              Subject to applicable law, you can request access to your data, correction of inaccurate
              data, deletion, restriction, or information about how your data is used. Contact
              {" "}<a href={`mailto:${MOOVU_SUPPORT_EMAIL}`}>{MOOVU_SUPPORT_EMAIL}</a>.
            </p>
          </section>

          <section className="legal-section">
            <h2>10. Contact</h2>
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
