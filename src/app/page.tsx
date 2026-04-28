import Image from "next/image";
import Link from "next/link";
import CustomerAppHeader from "@/components/app-shell/CustomerAppHeader";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import MetricCard from "@/components/ui/MetricCard";

const savedPlaces = [
  { label: "Home", description: "Set your pickup from your saved home address." },
  { label: "Work", description: "Jump straight into your regular commute." },
  { label: "Recent", description: "Use a place from your latest MOOVU trips." },
];

export default function HomePage() {
  return (
    <main className="moovu-app-screen">
      <div className="moovu-app-container">
        <CustomerAppHeader
          title="Where to?"
          subtitle="Book, track, and manage your MOOVU rides."
          actionHref="/customer/auth"
          actionLabel="Account"
        />

        <section className="grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(380px,0.58fr)]">
          <div className="moovu-app-panel overflow-hidden">
            <div className="moovu-home-map">
              <div className="moovu-home-map-grid" />
              <div className="moovu-home-route-card">
                <span className="moovu-home-route-pin" />
                <span className="moovu-home-route-line" />
                <span className="moovu-home-route-stop" />
              </div>
              <Image
                src="/Moovu-Black.png"
                alt="MOOVU"
                width={320}
                height={140}
                priority
                className="moovu-home-logo"
              />
            </div>

            <div className="p-4 sm:p-5">
              <Link href="/book" className="moovu-where-card" aria-label="Book a ride">
                <div>
                  <div className="moovu-kicker">Ride now</div>
                  <div className="mt-1 text-2xl font-black tracking-tight text-slate-950">
                    Where to?
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Choose pickup and destination, then MOOVU calculates your route and fare.
                  </p>
                </div>
                <span className="moovu-where-arrow">Go</span>
              </Link>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <MetricCard label="Status" value="Ready" helper="Customer booking" tone="primary" />
                <MetricCard label="Payment" value="Cash" helper="Local friendly" />
                <MetricCard label="Updates" value="Live" helper="Trip notifications" tone="success" />
              </div>
            </div>
          </div>

          <aside className="grid content-start gap-4">
            <section className="moovu-app-card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="moovu-kicker">Quick actions</div>
                  <h2 className="mt-1 text-xl font-black text-slate-950">Move faster</h2>
                </div>
                <Link href="/ride/history" className="moovu-header-action">
                  Trips
                </Link>
              </div>

              <div className="mt-4 grid gap-2">
                <Link href="/book" className="moovu-action-row">
                  <span className="moovu-action-mark primary" />
                  <span>
                    <strong>Book a ride</strong>
                    <small>Map-first booking with automatic fare calculation.</small>
                  </span>
                </Link>
                <Link href="/ride/history" className="moovu-action-row">
                  <span className="moovu-action-mark" />
                  <span>
                    <strong>Ride history</strong>
                    <small>Track trips and open customer receipts.</small>
                  </span>
                </Link>
                <Link href="/customer/auth" className="moovu-action-row">
                  <span className="moovu-action-mark mint" />
                  <span>
                    <strong>Account</strong>
                    <small>Manage sign in and notification permission.</small>
                  </span>
                </Link>
              </div>
            </section>

            <section className="moovu-app-card p-4 sm:p-5">
              <div className="moovu-kicker">Saved and recent places</div>
              <div className="mt-4 grid gap-3">
                {savedPlaces.map((place) => (
                  <div key={place.label} className="moovu-place-card">
                    <span className="moovu-place-dot" />
                    <div className="min-w-0">
                      <div className="font-black text-slate-950">{place.label}</div>
                      <p className="mt-1 text-sm leading-5 text-slate-600">{place.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* TASK 6 — "Drive with MOOVU" replaces admin portal section */}
            <section className="moovu-app-card p-4 sm:p-5">
              <div className="moovu-kicker">Drive with MOOVU</div>
              <h2 className="mt-1 text-xl font-black text-slate-950">Join our driver network</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Apply to join the MOOVU driver network or access your driver portal.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Link href="/driver/apply" className="moovu-btn moovu-btn-primary">
                  Become a driver
                </Link>
                <Link href="/driver/login" className="moovu-btn moovu-btn-secondary">
                  Driver portal
                </Link>
              </div>
            </section>
          </aside>
        </section>
      </div>

      <CustomerBottomNav />
    </main>
  );
}
