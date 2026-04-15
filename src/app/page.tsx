import Link from "next/link";
import Image from "next/image";

const featureCards = [
  ["Current Location Pickup", "Use live location as pickup for faster requests."],
  ["Live Tracking", "Riders see the driver, route and ETA in real time."],
  ["Driver Trip Controls", "Arrive, start and complete trips from one screen."],
  ["Dispatch Board", "Admins monitor trip states and assignments live."],
  ["Driver GPS Heartbeat", "Driver location updates continuously while online."],
  ["Cash-Friendly Flow", "Simple local payment handling while the app grows."],
];

const rideFlow = [
  ["Request", "Enter trip details and calculate fare."],
  ["Dispatch", "Nearby active drivers receive offers."],
  ["Track", "Follow the driver live on the map."],
  ["Complete", "Finish the ride smoothly and clearly."],
];

export default function HomePage() {
  return (
    <main className="moovu-page text-black">
      <div className="moovu-shell">
        <section className="moovu-panel overflow-hidden px-6 py-7 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--moovu-primary)]" />
              MOOVU Kasi Rides
            </div>

            <div className="flex flex-wrap gap-3">
              <Link href="/book" className="moovu-btn moovu-btn-primary">
                Book a Ride
              </Link>
              <Link href="/driver/apply" className="moovu-btn moovu-btn-secondary">
                Become a Driver
              </Link>
              <Link href="/admin/login" className="moovu-btn moovu-btn-ghost">
                Admin
              </Link>
            </div>
          </div>

          <div className="moovu-hero-grid mt-8">
            <div className="space-y-6">
              <div className="moovu-chip">
                <span className="moovu-chip-dot" />
                Smart local transport for everyday movement
              </div>

              <div className="space-y-4">
                <h1 className="moovu-heading-xl">
                  Safe, simple and smart rides with{" "}
                  <span style={{ color: "var(--moovu-primary)" }}>MOOVU</span>
                </h1>
                <p className="max-w-2xl text-base md:text-lg moovu-subtext">
                  Book a ride, track your driver live, and move around your area with
                  confidence. MOOVU brings modern ride-hailing to local communities
                  without moving away from the clean blue-and-white MOOVU identity.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="moovu-stat-card">
                  <div className="moovu-stat-label">Experience</div>
                  <div className="moovu-stat-value">Fast</div>
                  <p className="mt-2 text-sm text-slate-600">
                    Quick booking and dispatch
                  </p>
                </div>
                <div className="moovu-stat-card">
                  <div className="moovu-stat-label">Visibility</div>
                  <div className="moovu-stat-value">Live</div>
                  <p className="mt-2 text-sm text-slate-600">
                    Real-time rider and driver tracking
                  </p>
                </div>
                <div className="moovu-stat-card moovu-stat-card-primary">
                  <div className="moovu-stat-label">Built for</div>
                  <div className="moovu-stat-value">Kasi</div>
                  <p className="mt-2 text-sm text-slate-600">
                    Designed for local transport realities
                  </p>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="moovu-card p-6 md:p-8">
                <div className="flex items-center justify-center rounded-[28px] bg-[var(--moovu-bg-soft)] px-6 py-8">
                  <Image
                    src="/Moovu-Black.png"
                    alt="MOOVU"
                    width={320}
                    height={160}
                    priority
                    style={{
                      width: "230px",
                      height: "auto",
                      objectFit: "contain",
                    }}
                  />
                </div>

                <div className="mt-6 grid gap-3">
                  <div className="moovu-card-soft p-4">
                    <div className="text-sm text-slate-500">Step 1</div>
                    <div className="mt-1 text-lg font-semibold">Request a ride</div>
                    <p className="mt-2 text-sm text-slate-600">
                      Enter pickup, destination and rider details.
                    </p>
                  </div>

                  <div className="moovu-card-soft p-4">
                    <div className="text-sm text-slate-500">Step 2</div>
                    <div className="mt-1 text-lg font-semibold">Get matched</div>
                    <p className="mt-2 text-sm text-slate-600">
                      The nearest eligible driver receives your trip.
                    </p>
                  </div>

                  <div className="moovu-card-soft p-4">
                    <div className="text-sm text-slate-500">Step 3</div>
                    <div className="mt-1 text-lg font-semibold">Track live</div>
                    <p className="mt-2 text-sm text-slate-600">
                      See driver, vehicle details, route and trip progress clearly.
                    </p>
                  </div>

                  <Link href="/book" className="moovu-btn moovu-btn-primary w-full">
                    Start booking
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="moovu-card p-6 md:p-7">
            <div className="moovu-section-title">How it works</div>
            <h2 className="mt-3 moovu-heading-lg">
              A ride flow that feels clean and dependable
            </h2>
            <p className="mt-3 moovu-subtext">
              MOOVU keeps booking, dispatch, driver movement and trip progress
              clear for everyone involved.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {rideFlow.map(([title, text]) => (
                <div key={title} className="moovu-card-soft p-4">
                  <div className="text-lg font-semibold text-slate-900">{title}</div>
                  <p className="mt-2 text-sm text-slate-600">{text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="moovu-card p-6 md:p-7">
            <div className="moovu-section-title">Features</div>
            <h2 className="mt-3 moovu-heading-lg">Built for real transport operations</h2>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {featureCards.map(([title, text]) => (
                <div key={title} className="moovu-card-soft p-4">
                  <div className="text-base font-semibold text-slate-900">{title}</div>
                  <p className="mt-2 text-sm text-slate-600">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}