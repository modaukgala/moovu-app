"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import { supabaseClient } from "@/lib/supabase/client";

const rideOptions = [
  {
    name: "MOOVU Go",
    capacity: "Up to 3 riders",
    detail: "Everyday local trips",
    price: "From R40",
    icon: "Go",
    image: "/icons/moovu-go-clean.png",
  },
  {
    name: "MOOVU Go XL",
    capacity: "Up to 6 riders",
    detail: "More space for groups",
    price: "From R70",
    icon: "XL",
    image: "/icons/moovu-go-xl-clean.png",
  },
] as const;

const trustCards = [
  { title: "Verified local drivers", detail: "See driver, vehicle and plate details after acceptance." },
  { title: "OTP-protected trip starts", detail: "Trips start only after the correct rider OTP is confirmed." },
  { title: "Live driver tracking", detail: "Follow your driver and ride progress from pickup to destination." },
  { title: "Clear trip receipts", detail: "Access your completed trip receipt after the ride." },
  { title: "Cash-friendly local rides", detail: "Built around the way local township trips are taken." },
  { title: "Driver details before pickup", detail: "Confirm the car and driver before getting into the vehicle." },
] as const;

const howItWorks = [
  "Enter pickup and destination",
  "Choose MOOVU Go or Go XL",
  "Confirm your ride",
  "Track your driver and ride safely",
] as const;

export default function HomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      const { data } = await supabaseClient.auth.getSession();

      if (!mounted) return;
      setIsLoggedIn(Boolean(data.session));
      setCheckingAuth(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(Boolean(session));
      setCheckingAuth(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const bookingHref = useMemo(
    () => (isLoggedIn ? "/book" : "/customer/auth?next=/book"),
    [isLoggedIn],
  );

  const accountHref = isLoggedIn ? "/ride/history" : "/customer/auth?next=/book";
  const accountLabel = checkingAuth ? "Checking" : isLoggedIn ? "Trips" : "Sign in";

  return (
    <main className="customer-landing">
      <section className="customer-landing-shell">
        <header className="customer-landing-header">
          <Link href="/" className="customer-brand-lockup" aria-label="MOOVU home">
            <span className="customer-brand-logo">
              <Image src="/logo.png" alt="" width={34} height={34} priority className="h-9 w-9 object-contain" />
            </span>
            <span className="min-w-0">
              <span className="customer-brand-kicker">MOOVU</span>
              <span className="customer-brand-title">Kasi Rides</span>
            </span>
          </Link>

          <nav className="customer-landing-actions" aria-label="Customer links">
            <Link href="/ride/history" className="customer-header-link">Trips</Link>
            <Link href={accountHref} className="customer-header-pill">{accountLabel}</Link>
          </nav>
        </header>

        <section className="customer-hero-grid">
          <div className="customer-hero-copy">
            <div className="customer-hero-eyebrow">
              <span className="customer-live-dot" />
              Local township rides
            </div>

            <h1>Your local ride, just a few taps away.</h1>
            <p>
              Book safe, reliable local trips with nearby MOOVU drivers, OTP trip starts,
              live updates and clear receipts.
            </p>

            <div className="customer-hero-assurance">
              <span>Verified drivers</span>
              <span>OTP starts</span>
              <span>Receipts</span>
            </div>
          </div>

          <div className="customer-phone-stage" aria-label="MOOVU app preview">
            <div className="customer-map-card">
              <div className="customer-map-grid" />
              <div className="customer-map-pin customer-map-pin-pickup" />
              <div className="customer-map-pin customer-map-pin-dropoff" />
              <div className="customer-map-route" />
              <div className="customer-phone-mockup">
                <span className="customer-phone-speaker" />
                <span className="customer-phone-button-side customer-phone-button-side-left" />
                <span className="customer-phone-button-side customer-phone-button-side-right" />
                <div className="customer-phone-status">
                  <span>9:41</span>
                  <span className="customer-phone-camera" />
                  <span>5G</span>
                </div>
                <div className="customer-phone-top">
                  <span>MOOVU</span>
                  <strong>Ready</strong>
                </div>
                <div className="customer-phone-search">
                  <span className="customer-phone-dot" />
                  <div>
                    <small>Pickup</small>
                    <strong>My current location</strong>
                  </div>
                </div>
                <div className="customer-phone-search">
                  <span className="customer-phone-square" />
                  <div>
                    <small>Destination</small>
                    <strong>Siyabuswa Mall</strong>
                  </div>
                </div>
                <div className="customer-phone-ride">
                  <Image src="/icons/moovu-go-clean.png" alt="" width={62} height={42} className="customer-vehicle-art" />
                  <div>
                    <strong>MOOVU Go</strong>
                    <span>Everyday local trips</span>
                  </div>
                  <b>R40+</b>
                </div>
                <Link href={bookingHref} className="customer-phone-button">
                  Confirm ride
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="customer-booking-preview" aria-label="Start booking">
          <div className="customer-booking-card">
            <div>
              <span className="customer-section-kicker">Start here</span>
              <h2>Where to?</h2>
              <p>Set your pickup, add a destination, choose a ride type and confirm when the fare is ready.</p>
            </div>
            <Link href={bookingHref} className="customer-booking-button">
              Book now
            </Link>
          </div>

          <div className="customer-ride-grid">
            {rideOptions.map((option) => (
              <Link key={option.name} href={bookingHref} className="customer-ride-card">
                <span className="customer-ride-icon">
                  <Image src={option.image} alt={option.name} width={220} height={220} />
                </span>
                <span className="customer-ride-meta">
                  <strong>{option.capacity}</strong>
                  <small>{option.price}</small>
                  <em>{option.detail}</em>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="customer-section-block">
          <div className="customer-section-heading">
            <span className="customer-section-kicker">How MOOVU works</span>
            <h2>A guided ride flow from request to receipt.</h2>
          </div>
          <div className="customer-steps-grid">
            {howItWorks.map((step, index) => (
              <div key={step} className="customer-step-card">
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="customer-section-block">
          <div className="customer-section-heading">
            <span className="customer-section-kicker">Trust and safety</span>
            <h2>Built for confident local movement.</h2>
          </div>
          <div className="customer-trust-grid">
            {trustCards.map((card) => (
              <article key={card.title} className="customer-trust-card">
                <span className="customer-trust-mark" />
                <strong>{card.title}</strong>
                <p>{card.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="customer-service-area">
          <div>
            <span className="customer-section-kicker">Service areas</span>
            <h2>Focused on Siyabuswa and nearby local travel.</h2>
            <p>
              MOOVU is growing around Siyabuswa, KwaMhlanga, KwaNdebele nearby areas,
              and everyday township travel routes. Availability may vary as the driver
              network expands.
            </p>
          </div>
          <div className="customer-area-pills">
            <span>Siyabuswa</span>
            <span>KwaMhlanga</span>
            <span>KwaNdebele nearby</span>
            <span>Local township travel</span>
          </div>
        </section>

        <section className="customer-driver-apply-panel">
          <div>
            <span className="customer-section-kicker">Drive with MOOVU</span>
            <h2>Earn with local trips in your area.</h2>
            <p>
              Apply to drive with MOOVU and help move people safely around local routes.
            </p>
          </div>
          <Link href="/driver/apply" className="customer-secondary-cta">
            Apply to Drive
          </Link>
        </section>

        <footer className="customer-landing-footer">
          <Link href="/privacy-policy">Privacy Policy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/contact">Contact</Link>
        </footer>
      </section>

      <div className="customer-bottom-cta-dock" aria-label="Main actions">
        <Link href={bookingHref} className="customer-primary-cta">
          Book a Ride
        </Link>
      </div>

      <CustomerBottomNav />
    </main>
  );
}
