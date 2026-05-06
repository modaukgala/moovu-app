"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import { supabaseClient } from "@/lib/supabase/client";

const quickTrustPoints = [
  { label: "Local rides", detail: "Fast kasi pickups" },
  { label: "Live tracking", detail: "Follow every trip" },
  { label: "OTP secure", detail: "Protected starts" },
  { label: "Receipts", detail: "Proof after trips" },
] as const;

const rideOptions = [
  {
    name: "MOOVU Go",
    capacity: "Up to 3 riders",
    detail: "Everyday local rides",
    price: "From R40",
  },
  {
    name: "MOOVU Group",
    capacity: "Up to 6 riders",
    detail: "Larger vehicle requests",
    price: "From R75",
  },
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

  const accountHref = isLoggedIn ? "/book" : "/customer/auth?next=/book";

  return (
    <main className="min-h-svh bg-[#f6fafc] pb-[calc(94px+env(safe-area-inset-bottom))] text-[#050505]">
      <section className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-4 pt-[calc(16px+env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-3 py-2">
          <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="MOOVU home">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[18px] border border-[#d7e2ea] bg-white shadow-sm">
              <Image src="/logo.png" alt="" width={34} height={34} priority className="h-8 w-8 object-contain" />
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-[#5b6776]">
                MOOVU Kasi Rides
              </span>
              <span className="block truncate text-lg font-black text-[#050505]">Customer app</span>
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/ride/history"
              className="hidden min-h-11 items-center rounded-full border border-[#d7e2ea] bg-white px-4 text-sm font-extrabold text-[#050505] shadow-sm sm:inline-flex"
            >
              Trips
            </Link>
            <Link
              href={accountHref}
              className="inline-flex min-h-11 items-center rounded-full border border-[#d7e2ea] bg-white px-4 text-sm font-extrabold text-[#050505] shadow-sm"
            >
              {isLoggedIn ? "Book" : "Sign in"}
            </Link>
          </div>
        </header>

        <div className="grid flex-1 items-start gap-5 py-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(430px,1.12fr)] lg:items-center lg:gap-8 lg:py-8">
          <section className="overflow-hidden rounded-[28px] border border-[#d7e2ea] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.10)]">
            <div className="relative overflow-hidden bg-[#050505] px-5 py-6 text-white sm:px-7 sm:py-8">
              <div className="absolute right-[-70px] top-[-90px] h-52 w-52 rounded-full bg-[#1f74c9]/35 blur-3xl" />
              <div className="absolute bottom-[-90px] left-[-80px] h-48 w-48 rounded-full bg-[#c0f0e0]/25 blur-3xl" />

              <div className="relative z-10">
                <div className="mb-7 flex items-center justify-between gap-4">
                  <Image
                    src="/Moovu-White.png"
                    alt="MOOVU Kasi Rides"
                    width={156}
                    height={62}
                    priority
                    className="h-auto w-36 object-contain"
                  />
                  <span className="rounded-full bg-white/12 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white/85">
                    Ready
                  </span>
                </div>

                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#b0e0f0]">
                  Ride with MOOVU
                </p>
                <h1 className="mt-3 max-w-xl text-4xl font-black leading-[0.98] tracking-normal sm:text-5xl">
                  Your local ride, ready when you are.
                </h1>
                <p className="mt-4 max-w-lg text-sm leading-6 text-white/76 sm:text-base">
                  Book clean local trips with live driver updates, secure OTP trip starts, and receipts after every ride.
                </p>
              </div>
            </div>

            <div className="grid gap-4 p-4 sm:p-5">
              <Link
                href={bookingHref}
                className="group grid min-h-[132px] gap-4 rounded-[24px] border border-[#d7e2ea] bg-[#f8fbff] p-4 transition hover:border-[#1f74c9] hover:bg-white sm:p-5"
                aria-label="Start booking a MOOVU ride"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#5b6776]">
                      Start a ride
                    </p>
                    <h2 className="mt-2 text-3xl font-black leading-none text-[#050505]">Where to?</h2>
                  </div>
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#1f74c9] text-lg font-black text-white shadow-[0_14px_26px_rgba(31,116,201,0.24)] transition group-hover:bg-[#244f9e]">
                    Go
                  </span>
                </div>

                <div className="grid gap-2 rounded-[18px] bg-white p-3 ring-1 ring-[#d7e2ea]">
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full bg-[#1f74c9]" />
                    <span className="min-w-0 text-sm font-bold text-[#050505]">Use pickup or type another address</span>
                  </div>
                  <div className="ml-[5px] h-4 w-px bg-[#d7e2ea]" />
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-[4px] bg-[#050505]" />
                    <span className="min-w-0 text-sm font-bold text-[#050505]">Enter destination</span>
                  </div>
                </div>

                <span className="text-sm font-bold text-[#1f74c9]">
                  {checkingAuth
                    ? "Checking your account..."
                    : isLoggedIn
                      ? "Open booking"
                      : "Sign in or create account, then continue to booking"}
                </span>
              </Link>

              <div className="grid grid-cols-2 gap-3">
                {rideOptions.map((option) => (
                  <Link
                    key={option.name}
                    href={bookingHref}
                    className="rounded-[22px] border border-[#d7e2ea] bg-white p-4 shadow-sm transition hover:border-[#1f74c9]"
                  >
                    <h3 className="text-base font-black text-[#050505]">{option.name}</h3>
                    <p className="mt-1 text-xs font-bold text-[#5b6776]">{option.capacity}</p>
                    <p className="mt-2 text-xs leading-5 text-[#5b6776]">{option.detail}</p>
                    <p className="mt-3 text-sm font-black text-[#1f74c9]">{option.price}</p>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-4">
            <div className="rounded-[28px] border border-[#d7e2ea] bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#5b6776]">
                    Trip confidence
                  </p>
                  <h2 className="mt-1 text-2xl font-black text-[#050505]">Built for everyday local movement</h2>
                </div>
                <span className="hidden rounded-full bg-[#ecfdf3] px-3 py-2 text-xs font-black text-[#166534] sm:inline-flex">
                  Online
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {quickTrustPoints.map((point) => (
                  <div key={point.label} className="rounded-[20px] border border-[#d7e2ea] bg-[#f8fbff] p-4">
                    <p className="text-sm font-black text-[#050505]">{point.label}</p>
                    <p className="mt-1 text-xs font-semibold text-[#5b6776]">{point.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative min-h-[270px] overflow-hidden rounded-[28px] border border-[#d7e2ea] bg-[#dff1fb] shadow-sm">
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.35)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.35)_1px,transparent_1px)] bg-[size:52px_52px]" />
              <div className="absolute left-8 top-9 h-10 w-10 rounded-full bg-[#1f74c9] shadow-[0_12px_28px_rgba(31,116,201,0.28)]" />
              <div className="absolute bottom-12 right-10 h-12 w-12 rounded-[18px] bg-[#050505] shadow-[0_12px_28px_rgba(5,5,5,0.22)]" />
              <div className="absolute left-[27%] top-[44%] h-14 w-14 rounded-full border border-[#d7e2ea] bg-white shadow-xl" />
              <div className="absolute left-10 right-10 top-[49%] h-2 rounded-full bg-white/70">
                <div className="h-2 w-2/3 rounded-full bg-[#1f74c9]" />
              </div>

              <div className="absolute left-4 right-4 top-4 rounded-[22px] border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#5b6776]">Nearby driver</p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-3xl font-black text-[#050505]">4 min</p>
                    <p className="text-sm font-semibold text-[#5b6776]">Live pickup estimate</p>
                  </div>
                  <Link href={bookingHref} className="rounded-full bg-[#050505] px-4 py-3 text-sm font-black text-white">
                    Book
                  </Link>
                </div>
              </div>

              <div className="absolute bottom-4 left-4 right-4 rounded-[22px] border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-[#050505]">Driver details before pickup</p>
                    <p className="mt-1 text-xs font-semibold text-[#5b6776]">Name, vehicle, plate, and trip progress.</p>
                  </div>
                  <span className="rounded-full bg-[#eaf3ff] px-3 py-2 text-xs font-black text-[#244f9e]">Tracked</span>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-[#d7e2ea] bg-white p-4 shadow-sm sm:p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#5b6776]">Drive with MOOVU</p>
              <h2 className="mt-2 text-2xl font-black text-[#050505]">Earn with local trips</h2>
              <p className="mt-2 text-sm leading-6 text-[#5b6776]">
                Apply to join the MOOVU driver network or access your driver portal.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Link
                  href="/driver/apply"
                  className="inline-flex min-h-12 items-center justify-center rounded-[18px] bg-[#1f74c9] px-4 text-sm font-black text-white"
                >
                  Become a driver
                </Link>
                <Link
                  href="/driver/login"
                  className="inline-flex min-h-12 items-center justify-center rounded-[18px] border border-[#d7e2ea] bg-white px-4 text-sm font-black text-[#050505]"
                >
                  Driver portal
                </Link>
              </div>
            </div>
          </section>
        </div>

        <div className="mhp-legal-footer">
          <Link href="/privacy-policy">Privacy Policy</Link>
          <span>|</span>
          <Link href="/terms">Terms</Link>
          <span>|</span>
          <Link href="/contact">Contact</Link>
        </div>
      </section>

      <CustomerBottomNav />
    </main>
  );
}
