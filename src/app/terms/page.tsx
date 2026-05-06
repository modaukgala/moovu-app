import Link from "next/link";
import type { Metadata } from "next";
import { MOOVU_LEGAL_VERSION, MOOVU_SUPPORT_EMAIL, MOOVU_WEBSITE_URL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service | MOOVU Kasi Rides",
  description: "Terms for customers, drivers, payments, fares, OTP trip security, and platform use.",
};

const COMPANY = "MOOVU Kasi Rides";

export default function TermsPage() {
  return (
    <main className="legal-screen">
      <div className="legal-container">
        <div className="legal-header">
          <Link href="/" className="legal-back">Back to MOOVU</Link>
          <div className="legal-badge">Terms</div>
        </div>

        <h1 className="legal-title">Terms of Service</h1>
        <p className="legal-meta">{COMPANY} | Last updated: {MOOVU_LEGAL_VERSION}</p>

        <div className="legal-body">
          <section className="legal-section">
            <h2>1. Acceptance of terms</h2>
            <p>
              By creating an account, booking a ride, driving with MOOVU, or using any MOOVU portal,
              you agree to these Terms of Service and the MOOVU Privacy Policy. If you do not agree,
              do not use the platform.
            </p>
          </section>

          <section className="legal-section">
            <h2>2. Service description</h2>
            <p>
              {COMPANY} provides ride-hailing technology that connects customers with approved drivers.
              MOOVU Go is for everyday local rides for up to 3 riders. MOOVU Group is for larger vehicle
              requests for up to 6 riders. Drivers are independent service providers unless a written
              agreement states otherwise.
            </p>
          </section>

          <section className="legal-section">
            <h2>3. Customer responsibilities</h2>
            <ul>
              <li>Provide accurate account, pickup, destination, and contact information.</li>
              <li>Be ready at the pickup location and treat drivers and vehicles respectfully.</li>
              <li>Use the correct MOOVU ride option for the passenger group size.</li>
              <li>Do not share OTP codes except with the assigned driver for that trip.</li>
              <li>Pay the confirmed fare and keep receipts for your own records.</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>4. Driver responsibilities</h2>
            <ul>
              <li>Provide accurate identity, vehicle, contact, and document information.</li>
              <li>Keep the vehicle roadworthy, safe, insured where required, and legally compliant.</li>
              <li>Use the driver workflow honestly: accept, arrive, verify OTP, start, and complete trips accurately.</li>
              <li>Keep GPS/location availability current while online and use manual location only where appropriate.</li>
              <li>Pay applicable subscriptions and MOOVU platform commission when due.</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>5. Bookings, cancellations, and no-shows</h2>
            <p>
              A booking is created when a customer confirms a ride in the app. MOOVU may dispatch the
              request to available drivers. Customers and drivers should cancel only when necessary.
              Repeated no-shows, false bookings, or abusive cancellations may lead to account review,
              suspension, or removal from the platform.
            </p>
          </section>

          <section className="legal-section">
            <h2>6. Fares, payments, receipts, commissions, and subscriptions</h2>
            <p>
              Fare estimates are calculated using server-side pricing, ride option, distance, and
              duration data. The customer sees the final fare before booking. MOOVU Group costs more
              than MOOVU Go because it requests a larger vehicle.
            </p>
            <p>
              MOOVU currently supports payment proof review, receipts, driver commissions, driver
              subscriptions, and admin payment approval flows. The current MOOVU driver commission is
              7% on newly calculated completed trips. Existing historical records keep the commission
              amount stored at the time they were created unless MOOVU approves a separate migration.
            </p>
          </section>

          <section className="legal-section">
            <h2>7. OTP trip security</h2>
            <p>
              MOOVU uses OTP trip security to reduce wrong-passenger starts and workflow abuse.
              Customers must only provide the OTP to the assigned driver. Drivers must not start a
              trip without the correct OTP and active trip state.
            </p>
          </section>

          <section className="legal-section">
            <h2>8. Prohibited conduct</h2>
            <ul>
              <li>Fraud, fake trips, payment proof manipulation, fare manipulation, or OTP abuse.</li>
              <li>Harassment, threats, discrimination, unsafe conduct, or property damage.</li>
              <li>Attempting to access another user account, trip, receipt, driver profile, or admin function.</li>
              <li>Using MOOVU for unlawful transport, unsafe requests, or any illegal purpose.</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>9. Account suspension or termination</h2>
            <p>
              MOOVU may suspend, restrict, or terminate accounts for policy violations, unsafe conduct,
              fraud, unpaid platform amounts, false information, or legal/compliance concerns.
            </p>
          </section>

          <section className="legal-section">
            <h2>10. Limitation of liability</h2>
            <p>
              MOOVU provides a technology platform and operational tools. To the maximum extent allowed
              by law, MOOVU is not responsible for indirect loss, delays, user misconduct, third-party
              service outages, route conditions, or losses outside MOOVU&apos;s reasonable control.
            </p>
          </section>

          <section className="legal-section">
            <h2>11. Contact</h2>
            <p>
              For support, account, driver, payment, receipt, or terms questions, email
              {" "}<a href={`mailto:${MOOVU_SUPPORT_EMAIL}`}>{MOOVU_SUPPORT_EMAIL}</a>.
            </p>
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
