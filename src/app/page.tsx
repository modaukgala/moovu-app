import Link from "next/link";
import Image from "next/image";

export default function HomePage() {
  return (
    <main className="min-h-screen text-black">
      <header
        className="container grid2" style={{ paddingTop: 28, paddingBottom: 18 }}>

        <div style={{ padding: "10px 0" }}>
          {/* LOGO + TITLE (replaces CR block) */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              marginBottom: 18,
            }}
          >
            <Image
              src="/Moovu-Black.png"
              alt="MOOVU"
              width={320}
              height={160}
              priority
              style={{
                width: "220px",
                height: "auto",
                objectFit: "contain",
                filter:
                  "drop-shadow(0 10px 26px rgba(0,0,0,0.55)) drop-shadow(0 0 18px rgba(227,28,61,0.18))",
              }}
            />

            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 40, fontWeight: 950, letterSpacing: 0.6 }}>
                MOOVU KASI RIDES
              </div>
              <div style={{ fontSize: 20, opacity: 0.75 }}>Safe • Fast • Trusted</div>
            </div>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-24 grid lg:grid-cols-2 gap-10 items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 border rounded-full px-4 py-2 text-sm bg-white shadow-sm text-black">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: "var(--moovu-primary)" }}
              />
              Smarter local transport for everyday movement
            </div>

            <div className="space-y-4">
              <h1 className="text-4xl md:text-6xl font-semibold leading-tight text-black">
                Safe, simple and smart rides with{" "}
                <span style={{ color: "var(--moovu-primary)" }}>MOOVU</span>
              </h1>
              <p className="text-base md:text-lg text-gray-700 max-w-xl">
                Book a ride, track your driver live, and move around your area with
                confidence. MOOVU brings modern ride-hailing to local communities.
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
                  Quick booking and dispatch
                </div>
              </div>
              <div className="border rounded-2xl p-4 bg-white shadow-sm">
                <div className="text-2xl font-semibold text-black">Visible</div>
                <div className="text-sm text-gray-600 mt-1">
                  Live rider and driver tracking
                </div>
              </div>
              <div className="border rounded-2xl p-4 bg-white shadow-sm">
                <div className="text-2xl font-semibold text-black">Local</div>
                <div className="text-sm text-gray-600 mt-1">
                  Designed for kasi transport
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div
              className="rounded-[2rem] p-6 border shadow-sm"
              style={{
                background:
                  "linear-gradient(160deg, rgba(255,255,255,0.98), rgba(220,235,255,0.95))",
              }}
            >
              <div className="grid gap-4">
                <div className="border rounded-2xl p-5 bg-white">
                  <div className="text-sm text-gray-500">Step 1</div>
                  <div className="text-xl font-semibold text-black mt-1">Request a ride</div>
                  <p className="text-sm text-gray-700 mt-2">
                    Enter pickup, destination and rider details.
                  </p>
                </div>

                <div className="border rounded-2xl p-5 bg-white">
                  <div className="text-sm text-gray-500">Step 2</div>
                  <div className="text-xl font-semibold text-black mt-1">Get matched</div>
                  <p className="text-sm text-gray-700 mt-2">
                    The nearest eligible driver receives your trip.
                  </p>
                </div>

                <div className="border rounded-2xl p-5 bg-white">
                  <div className="text-sm text-gray-500">Step 3</div>
                  <div className="text-xl font-semibold text-black mt-1">Track live</div>
                  <p className="text-sm text-gray-700 mt-2">
                    See your driver, car details, route and ETA in real time.
                  </p>
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
              A ride flow that feels clean and dependable
            </h2>
            <p className="text-gray-700 mt-3">
              MOOVU is built to keep booking, dispatch, driver movement and trip
              progress clear for everyone involved.
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-4">
            {[
              ["Request", "Enter trip details and calculate fare."],
              ["Dispatch", "Nearby active drivers receive offers."],
              ["Track", "Follow the driver live on the map."],
              ["Complete", "Finish the ride smoothly and clearly."],
            ].map(([title, text]) => (
              <div key={title} className="border rounded-2xl p-5 bg-white shadow-sm">
                <div className="text-xl font-semibold mt-1 text-black">{title}</div>
                <p className="text-sm text-gray-700 mt-2">{text}</p>
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
              Built for real transport operations
            </h2>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            {[
              ["Current Location Pickup", "Use live location as pickup for faster requests."],
              ["Live Tracking", "Riders see the driver, route and ETA in real time."],
              ["Driver Trip Controls", "Arrive, start and complete trips from one screen."],
              ["Dispatch Board", "Admins monitor trip states and assignments live."],
              ["Driver GPS Heartbeat", "Driver location updates continuously while online."],
              ["Cash-Friendly Flow", "Simple local payment handling while the app grows."],
            ].map(([title, text]) => (
              <div key={title} className="border rounded-2xl p-6 bg-white shadow-sm">
                <div className="text-xl font-semibold text-black">{title}</div>
                <p className="text-sm text-gray-700 mt-3">{text}</p>
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
                Apply, get approved, go online, receive nearby bookings and manage
                every trip from your driver dashboard.
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
                ["Online / Offline", "Drivers control availability and visibility."],
                ["Trip Controls", "Accept, arrive, start and complete trips."],
                ["Navigation", "Open pickup and dropoff in Maps or Waze."],
                ["Trust", "Riders see driver and vehicle details live."],
              ].map(([title, text]) => (
                <div key={title} className="border rounded-2xl p-5 bg-white shadow-sm">
                  <div className="text-lg font-semibold text-black">{title}</div>
                  <p className="text-sm text-gray-700 mt-2">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t" style={{ background: "rgba(255,255,255,0.78)" }}>
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-sm">
          <div>
            <div className="font-semibold text-black">MOOVU Kasi Rides</div>
            <div className="text-gray-600 mt-1">Smarter movement for local communities.</div>
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