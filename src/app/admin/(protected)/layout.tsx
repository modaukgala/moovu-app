"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import AdminTripNotifications from "@/components/AdminTripNotifications";
import EnablePushButton from "@/components/EnablePushButton";

export default function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!mounted) return;

      if (!session) {
        const host =
          typeof window !== "undefined" ? window.location.host.toLowerCase() : "";
        const isAdminHost =
          host === "admin.moovurides.co.za" ||
          host.startsWith("admin.localhost") ||
          host.startsWith("admin.127.0.0.1");

        const next = pathname || "/admin";

        if (isAdminHost) {
          window.location.href = `/login?next=${encodeURIComponent(next)}`;
        } else {
          window.location.href = `/admin/login?next=${encodeURIComponent(next)}`;
        }
        return;
      }

      setChecking(false);
    }

    checkAuth();

    return () => {
      mounted = false;
    };
  }, [pathname]);

  async function handleLogout() {
    await supabaseClient.auth.signOut();

    const host =
      typeof window !== "undefined" ? window.location.host.toLowerCase() : "";
    const isAdminHost =
      host === "admin.moovurides.co.za" ||
      host.startsWith("admin.localhost") ||
      host.startsWith("admin.127.0.0.1");

    if (isAdminHost) {
      window.location.href = "/login";
    } else {
      window.location.href = "/admin/login";
    }
  }

  function navClass(href: string) {
    const active =
      pathname === href || (href !== "/admin" && pathname.startsWith(href));

    return `block border rounded-2xl px-4 py-3 transition ${
      active
        ? "text-white"
        : "bg-white text-black hover:bg-black hover:text-white"
    }`;
  }

  if (checking) {
    return (
      <main className="min-h-screen grid place-items-center p-6 text-black">
        <div className="border rounded-[2rem] p-6 bg-white shadow-sm">
          Checking admin access...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-black">
      <AdminTripNotifications />

      <div className="min-h-screen grid lg:grid-cols-[300px_1fr]">
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

            <EnablePushButton role="admin" />

            <nav className="space-y-2">
              <Link
                href="/admin"
                className={navClass("/admin")}
                style={
                  pathname === "/admin"
                    ? { background: "var(--moovu-primary)" }
                    : undefined
                }
              >
                Dashboard
              </Link>

              <Link
                href="/admin/drivers"
                className={navClass("/admin/drivers")}
                style={
                  pathname.startsWith("/admin/drivers")
                    ? { background: "var(--moovu-primary)" }
                    : undefined
                }
              >
                Drivers
              </Link>

              <Link
                href="/admin/trips"
                className={navClass("/admin/trips")}
                style={
                  pathname.startsWith("/admin/trips")
                    ? { background: "var(--moovu-primary)" }
                    : undefined
                }
              >
                Trips
              </Link>

              <Link
                href="/admin/dispatch/map"
                className={navClass("/admin/dispatch/map")}
                style={
                  pathname.startsWith("/admin/dispatch/map")
                    ? { background: "var(--moovu-primary)" }
                    : undefined
                }
              >
                Dispatch Map
              </Link>

              <Link
                href="/admin/applications"
                className={navClass("/admin/applications")}
                style={
                  pathname.startsWith("/admin/applications")
                    ? { background: "var(--moovu-primary)" }
                    : undefined
                }
              >
                Driver Applications
              </Link>

              <Link
                href="/admin/link-driver"
                className={navClass("/admin/link-driver")}
                style={
                  pathname.startsWith("/admin/link-driver")
                    ? { background: "var(--moovu-primary)" }
                    : undefined
                }
              >
                Link Driver
              </Link>

              <Link
                href="/admin/subscriptions"
                className={navClass("/admin/subscriptions")}
                style={
                  pathname.startsWith("/admin/subscriptions")
                    ? { background: "var(--moovu-primary)" }
                    : undefined
                }
              >
                Subscriptions
              </Link>

              <Link
                href="/admin/reports"
                className={navClass("/admin/reports")}
                style={
                  pathname.startsWith("/admin/reports")
                    ? { background: "var(--moovu-primary)" }
                    : undefined
                }
              >
                Earnings Report
              </Link>

              <button
                onClick={handleLogout}
                className="w-full text-left border rounded-2xl px-4 py-3 bg-white text-black hover:bg-black hover:text-white transition"
              >
                Logout
              </button>
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
            <header className="border rounded-[2rem] px-6 py-5 bg-white shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
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