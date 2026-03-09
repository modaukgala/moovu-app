import Link from "next/link";
import Image from "next/image";

export default function HomePage() {
  return (
    <main className="min-h-screen text-black">
      <header
        className="sticky top-0 z-30 border-b backdrop-blur"
        style={{ background: "rgba(255,255,255,0.88)" }}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="rounded-2xl border shadow-sm bg-white px-3 py-2">
              <Image
                src="/logo/Moovu-Black.png"
                alt="MOOVU Kasi Rides"
                width={150}
                height={60}
                className="h-auto w-auto object-contain"
                priority
              />
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-2 text-sm">
            <a href="#how-it-works" className="px-3 py-2 rounded-xl hover:bg-white">
              How it works
            </a>
            <a href="#features" className="px-3 py-2 rounded-xl hover:bg-white">
              Features
            </a>
            <a href="#drivers" className="px-3 py-2 rounded-xl hover:bg-white">
              Drivers
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/driver/login"
              className="border rounded-xl px-4 py-2 text-sm bg-white text-black hover:bg-black hover:text-white"
            >
              Driver Login
            </Link>
            <Link
              href="/book"
              className="rounded-xl px-4 py-2 text-sm text-white"
              style={{ background: "var(--moovu-primary)" }}
            >
              Book Ride
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-24 grid lg:grid-cols-2 gap-10 items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 border rounded-full px-4 py-2 text-sm bg-white shadow-sm">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: "var(--moovu-primary)" }}
              />
              Smart local transport for everyday movement
            </div>

            <div className="space-y-4">
              <h1 className="text-4xl md:text-6xl font-semibold leading-tight text-black">
                Move smarter with{" "}
                <span style={{ color: "var(--moovu-primary)" }}>MOOVU</span>
              </h1>
              <p className="text-base md:text-lg text-gray-700 max-w-xl">
                A modern kasi ride platform for riders, drivers and operators.
                Book your ride, track your driver live, and enjoy a cleaner,
                faster transport experience.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/book"
                className="rounded-2xl px-5 py-3 text-white shadow-sm"
                style={{ background: "var(--moovu-primary)" }}
              >
                Book a Ride
              </Link>

              <Link
                href="/driver/apply"
                className="border rounded-2xl px-5 py-3 bg-white text-black hover:bg-black hover:text-white"
              >
                Become a Driver
              </Link>
            </div>

            <div className="grid sm:grid-cols-3 gap-4 pt-4">
              <div className="border rounded-2xl p-4 bg-white shadow-sm">
                <div className="text-2xl font-semibold text-black">Fast</div>
                <div className="text-sm text-gray-600 mt-1">
                  Quick booking and smart dispatch
                </div>
              </div>
              <div className="border rounded-2xl p-4 bg-white shadow-sm">
                <div className="text-2xl font-semibold text-black">Local</div>
                <div className="text-sm text-gray-600 mt-1">
                  Built for community transport
                </div>
              </div>
              <div className="border rounded-2xl p-4 bg-white shadow-sm">
                <div className="text-2xl font-semibold text-black">Tracked</div>
                <div className="text-sm text-gray-600 mt-1">
                  Live driver visibility and ETA
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div
              className="rounded-[2rem] p-5 md:p-6 shadow-sm border"
              style={{
                background:
                  "linear-gradient(160deg, rgba(255,255,255,0.96), rgba(220,235,255,0.96))",
              }}
            >
              <div className="border rounded-[1.5rem] p-5 space-y-5 bg-white">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm text-gray-500">MOOVU rider experience</div>
                    <div className="text-xl font-semibold mt-1 text-black">
                      From booking to drop-off
                    </div>
                  </div>
                  <div
                    className="rounded-xl px-3 py-2 text-sm text-white"
                    style={{ background: "var(--moovu-primary)" }}
                  >
                    Live
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="border rounded-2xl p-4 bg-white">
                    <div className="text-sm text-gray-500">1. Book</div>
                    <div className="font-medium mt-1 text-black">
                      Set pickup, destination and see estimated fare
                    </div>
                  </div>

                  <div className="border rounded-2xl p-4 bg-white">
                    <div className="text-sm text-gray-500">2. Dispatch</div>
                    <div className="font-medium mt-1 text-black">
                      Nearby eligible driver receives the trip
                    </div>
                  </div>

                  <div className="border rounded-2xl p-4 bg-white">
                    <div className="text-sm text-gray-500">3. Track live</div>
                    <div className="font-medium mt-1 text-black">
                      Watch driver details, route line and ETA
                    </div>
                  </div>

                  <div className="border rounded-2xl p-4 bg-white">
                    <div className="text-sm text-gray-500">4. Complete</div>
                    <div className="font-medium mt-1 text-black">
                      Clean trip completion for rider and driver
                    </div>
                  </div>
                </div>

                <Link
                  href="/book"
                  className="block text-center rounded-2xl px-5 py-3 text-white"
                  style={{ background: "var(--moovu-primary)" }}
                >
                  Start Booking
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-t">
        <div className="max-w-7xl mx-auto px-6 py-16 space-y-8">
          <div className="max-w-2xl">
            <div className="text-sm text-gray-500">How it works</div>
            <h2 className="text-3xl md:text-4xl font-semibold mt-2 text-black">
              Built for smooth everyday transport
            </h2>
            <p className="text-gray-700 mt-3">
              MOOVU keeps the full ride flow simple, from booking to dispatch,
              live tracking and completion.
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-4">
            {[
              ["Step 01", "Request", "Rider enters pickup, destination and details."],
              ["Step 02", "Assign", "The system offers the ride to nearby eligible drivers."],
              ["Step 03", "Track", "Rider sees driver details, route and trip progress."],
              ["Step 04", "Complete", "Trip is completed and recorded cleanly in the system."],
            ].map(([step, title, text]) => (
              <div key={step} className="border rounded-2xl p-5 bg-white shadow-sm">
                <div className="text-sm text-gray-500">{step}</div>
                <div className="text-xl font-semibold mt-2 text-black">{title}</div>
                <p className="text-gray-700 mt-2 text-sm">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="border-t">
        <div className="max-w-7xl mx-auto px-6 py-16 space-y-8">
          <div className="max-w-2xl">
            <div className="text-sm text-gray-500">Features</div>
            <h2 className="text-3xl md:text-4xl font-semibold mt-2 text-black">
              Transport technology with local relevance
            </h2>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            {[
              ["Smart Booking", "Use current location or search places with autocomplete."],
              ["Live Tracking", "Rider sees driver details, vehicle, route line and ETA."],
              ["Smart Dispatch", "Nearby drivers get offered trips with re-offer logic built in."],
              ["Driver Controls", "Accept, navigate, arrive, start and complete trips."],
              ["Admin Dispatch Board", "Full visibility into requested, active and completed trips."],
              ["Operational Reporting", "Earnings, subscriptions and trip tracking from one place."],
            ].map(([title, text]) => (
              <div key={title} className="border rounded-2xl p-6 bg-white shadow-sm">
                <div className="text-xl font-semibold text-black">{title}</div>
                <p className="text-gray-700 mt-3 text-sm">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="drivers" className="border-t">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div
            className="border rounded-[2rem] p-8 md:p-10 grid lg:grid-cols-2 gap-8 items-center"
            style={{
              background:
                "linear-gradient(145deg, rgba(201,232,218,0.45), rgba(169,210,242,0.45), rgba(255,255,255,0.96))",
            }}
          >
            <div className="space-y-4">
              <div className="text-sm text-gray-500">Drive with MOOVU</div>
              <h2 className="text-3xl md:text-4xl font-semibold text-black">
                Join the platform and start taking trips
              </h2>
              <p className="text-gray-700 max-w-xl">
                Apply, get approved, go online, receive nearby bookings and
                manage trips from your driver dashboard.
              </p>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/driver/apply"
                  className="rounded-2xl px-5 py-3 text-white"
                  style={{ background: "var(--moovu-primary)" }}
                >
                  Apply to Drive
                </Link>
                <Link
                  href="/driver/login"
                  className="border rounded-2xl px-5 py-3 bg-white text-black hover:bg-black hover:text-white"
                >
                  Driver Login
                </Link>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {[
                ["Online / Offline", "Drivers control availability and live location updates."],
                ["Trip Controls", "Accept, arrive, start and complete trips easily."],
                ["Navigation", "Open pickup and destination in Google Maps or Waze."],
                ["Visibility", "Live rider tracking builds trust and smoother trips."],
              ].map(([title, text]) => (
                <div key={title} className="border rounded-2xl p-5 bg-white shadow-sm">
                  <div className="text-lg font-semibold text-black">{title}</div>
                  <p className="text-gray-700 text-sm mt-2">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="border rounded-[2rem] p-8 md:p-10 text-center space-y-5 bg-white shadow-sm">
            <div className="text-sm text-gray-500">Ready to move?</div>
            <h2 className="text-3xl md:text-5xl font-semibold text-black">
              Book your next ride with MOOVU
            </h2>
            <p className="text-gray-700 max-w-2xl mx-auto">
              Fast request flow, local-first dispatch, live tracking and a more
              organised ride experience.
            </p>

            <div className="flex justify-center flex-wrap gap-3 pt-2">
              <Link
                href="/book"
                className="rounded-2xl px-5 py-3 text-white"
                style={{ background: "var(--moovu-primary)" }}
              >
                Book a Ride
              </Link>
              <Link
                href="/driver/apply"
                className="border rounded-2xl px-5 py-3 bg-white text-black hover:bg-black hover:text-white"
              >
                Apply to Drive
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t" style={{ background: "rgba(255,255,255,0.75)" }}>
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-sm">
          <div>
            <div className="font-semibold text-black">MOOVU Kasi Rides</div>
            <div className="text-gray-600 mt-1">
              Smarter movement for local communities.
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-gray-700">
            <Link href="/book">Book</Link>
            <Link href="/driver/login">Driver Login</Link>
            <Link href="/driver/apply">Drive with MOOVU</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}