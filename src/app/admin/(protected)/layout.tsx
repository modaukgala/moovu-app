import Link from "next/link";

export default function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen text-black">
      <div className="min-h-screen grid lg:grid-cols-[280px_1fr]">
        <aside className="border-r bg-white/90 backdrop-blur px-5 py-6">
          <div className="space-y-6">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm border bg-white shadow-sm">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: "var(--moovu-primary)" }}
                />
                MOOVU Admin
              </div>

              <h1 className="text-2xl font-semibold mt-4 text-black">
                Control Center
              </h1>

              <p className="text-sm text-gray-600 mt-2">
                Manage trips, dispatch and operations from one place.
              </p>
            </div>

            <nav className="space-y-2">
              <Link
                href="/admin"
                className="block border rounded-2xl px-4 py-3 bg-white hover:bg-black hover:text-white"
              >
                Dashboard
              </Link>

              <Link
                href="/admin/trips"
                className="block border rounded-2xl px-4 py-3 bg-white hover:bg-black hover:text-white"
              >
                Trips
              </Link>

              <Link
                href="/admin/dispatch/map"
                className="block border rounded-2xl px-4 py-3 bg-white hover:bg-black hover:text-white"
              >
                Dispatch Map
              </Link>

              <Link
                href="/admin/applications"
                className="block border rounded-2xl px-4 py-3 bg-white hover:bg-black hover:text-white"
              >
                Driver Applications
              </Link>

              <Link
                href="/admin/subscriptions"
                className="block border rounded-2xl px-4 py-3 bg-white hover:bg-black hover:text-white"
              >
                Subscriptions
              </Link>
            </nav>

            <div
              className="border rounded-[1.5rem] p-4"
              style={{ background: "var(--moovu-primary-soft)" }}
            >
              <div className="text-sm text-gray-600">MOOVU Operations</div>
              <div className="font-semibold mt-1 text-black">
                Smart local ride dispatch
              </div>
              <p className="text-sm text-gray-700 mt-2">
                Keep rider requests, driver movement and admin visibility aligned.
              </p>
            </div>
          </div>
        </aside>

        <section className="px-6 py-6 lg:px-8 lg:py-8">
          <div className="max-w-7xl mx-auto space-y-6">
            <header
              className="border rounded-[2rem] px-6 py-5 bg-white shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4"
            >
              <div>
                <div className="text-sm text-gray-500">MOOVU Admin Panel</div>
                <div className="text-2xl font-semibold text-black mt-1">
                  Operations Dashboard
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  href="/book"
                  className="border rounded-xl px-4 py-2 bg-white text-black hover:bg-black hover:text-white"
                >
                  View Rider Booking
                </Link>

                <Link
                  href="/driver/login"
                  className="rounded-xl px-4 py-2 text-white"
                  style={{ background: "var(--moovu-primary)" }}
                >
                  Driver Login
                </Link>
              </div>
            </header>

            {children}
          </div>
        </section>
      </div>
    </main>
  );
}