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
  },
  {
    name: "MOOVU Go XL",
    capacity: "Up to 6 riders",
    detail: "More space for groups",
    price: "From R70",
  },
] as const;

const trustPoints = [
  { label: "OTP protected", detail: "Start and finish trips with secure codes." },
  { label: "Live updates", detail: "Track driver progress after acceptance." },
  { label: "Receipts", detail: "Open trip receipts from history anytime." },
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
    <main className="min-h-dvh overflow-x-hidden bg-[linear-gradient(180deg,#eef8ff_0%,#f8fbff_42%,#f5f8fc_100%)] pb-[calc(104px+env(safe-area-inset-bottom))] text-[#050505]">
      <section className="mx-auto grid min-h-dvh w-full max-w-6xl gap-5 px-4 pt-[calc(14px+env(safe-area-inset-top))] sm:px-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)] lg:items-center lg:gap-8 lg:px-8">
        <div className="grid gap-4">
          <header className="flex items-center justify-between gap-3">
            <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="MOOVU home">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#d7e2ea] bg-white shadow-[0_10px_24px_rgba(31,116,201,0.08)]">
                <Image src="/logo.png" alt="" width={31} height={31} priority className="h-8 w-8 object-contain" />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-[#5b6776]">
                  MOOVU
                </span>
                <span className="block truncate text-base font-black text-[#050505]">
                  Kasi Rides
                </span>
              </span>
            </Link>

            <Link
              href={accountHref}
              className="inline-flex min-h-11 items-center rounded-full border border-[#d7e2ea] bg-white px-4 text-sm font-black text-[#050505] shadow-[0_10px_24px_rgba(31,116,201,0.07)] transition hover:border-[#1f74c9]"
            >
              {accountLabel}
            </Link>
          </header>

          <section className="overflow-hidden rounded-[30px] border border-[#d7e2ea] bg-white shadow-[0_26px_80px_rgba(15,23,42,0.10)]">
            <div className="relative overflow-hidden bg-[linear-gradient(135deg,#ffffff_0%,#eaf3ff_48%,#e9fff8_100%)] p-5 sm:p-6">
              <div className="pointer-events-none absolute right-[-86px] top-[-96px] h-56 w-56 rounded-full bg-[#1f74c9]/18 blur-3xl" />
              <div className="pointer-events-none absolute bottom-[-105px] left-[-88px] h-52 w-52 rounded-full bg-[#c0f0e0]/60 blur-3xl" />

              <div className="relative z-10">
                <div className="flex items-center justify-between gap-4">
                  <span className="rounded-full bg-white/84 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-[#244f9e] shadow-sm">
                    Ride with MOOVU
                  </span>
                  <span className="rounded-full bg-[#ecfdf3] px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-[#166534] shadow-sm">
                    Nearby
                  </span>
                </div>

                <h1 className="mt-6 max-w-lg text-[2.35rem] font-black leading-[0.96] tracking-normal text-[#050505] sm:text-5xl">
                  Where to?
                </h1>
                <p className="mt-3 max-w-md text-sm font-semibold leading-6 text-[#5b6776]">
                  Book local rides with nearby drivers, secure OTPs, live trip status, and receipts after every ride.
                </p>

                <Link
                  href={bookingHref}
                  className="mt-6 grid gap-3 rounded-[26px] border border-[#d7e2ea] bg-white p-4 shadow-[0_18px_42px_rgba(31,116,201,0.12)] transition active:scale-[0.99] hover:border-[#1f74c9]"
                  aria-label="Start booking a MOOVU ride"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#5b6776]">
                        Start booking
                      </p>
                      <p className="mt-1 truncate text-[1.35rem] font-black leading-tight text-[#050505] sm:text-2xl">
                        Enter destination
                      </p>
                    </div>
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#1f74c9] text-sm font-black text-white shadow-[0_14px_28px_rgba(31,116,201,0.24)] sm:h-12 sm:w-12">
                      Go
                    </span>
                  </div>

                  <div className="grid gap-2 rounded-[20px] bg-[#f8fbff] p-3 ring-1 ring-[#d7e2ea]">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="h-3 w-3 shrink-0 rounded-full bg-[#1f74c9]" />
                      <span className="truncate text-sm font-bold text-[#050505]">
                        Pickup from your location or typed address
                      </span>
                    </div>
                    <div className="ml-[5px] h-4 w-px bg-[#cad5e3]" />
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="h-3 w-3 shrink-0 rounded-[4px] bg-[#050505]" />
                      <span className="truncate text-sm font-bold text-[#050505]">
                        Choose where you are going
                      </span>
                    </div>
                  </div>

                  <span className="text-sm font-black text-[#1f74c9]">
                    {checkingAuth
                      ? "Checking your account..."
                      : isLoggedIn
                        ? "Open booking"
                        : "Sign in or create an account to continue"}
                  </span>
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 p-4 sm:p-5">
              {rideOptions.map((option) => (
                <Link
                  key={option.name}
                  href={bookingHref}
                  className="min-w-0 rounded-[23px] border border-[#d7e2ea] bg-[#fbfdff] p-4 shadow-sm transition active:scale-[0.99] hover:border-[#1f74c9] hover:bg-white"
                >
                  <h2 className="text-[15px] font-black leading-tight text-[#050505]">{option.name}</h2>
                  <p className="mt-1 text-xs font-black text-[#5b6776]">{option.capacity}</p>
                  <p className="mt-3 text-xs font-semibold leading-5 text-[#5b6776]">{option.detail}</p>
                  <p className="mt-3 text-sm font-black text-[#1f74c9]">{option.price}</p>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-4">
          <section className="relative min-h-[330px] overflow-hidden rounded-[32px] border border-[#d7e2ea] bg-[#dff1fb] shadow-[0_24px_70px_rgba(15,23,42,0.10)]">
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.42)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.42)_1px,transparent_1px)] bg-[size:52px_52px]" />
            <div className="absolute left-8 top-24 h-10 w-10 rounded-full bg-[#1f74c9] shadow-[0_14px_30px_rgba(31,116,201,0.28)]" />
            <div className="absolute bottom-20 right-10 h-12 w-12 rounded-[18px] bg-[#050505] shadow-[0_14px_30px_rgba(5,5,5,0.22)]" />
            <div className="absolute left-[24%] top-[55%] h-14 w-14 rounded-full border border-[#d7e2ea] bg-white shadow-xl" />
            <div className="absolute left-10 right-10 top-[60%] h-2 rounded-full bg-white/74">
              <div className="h-2 w-2/3 rounded-full bg-[#1f74c9]" />
            </div>

            <div className="absolute left-4 right-4 top-4 rounded-[24px] border border-white/70 bg-white/92 p-4 shadow-sm backdrop-blur">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#5b6776]">
                Nearby driver estimate
              </p>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <p className="text-4xl font-black leading-none text-[#050505]">4 min</p>
                  <p className="mt-1 text-sm font-semibold text-[#5b6776]">Available after pickup is set</p>
                </div>
                <Link href={bookingHref} className="rounded-full bg-[#050505] px-4 py-3 text-sm font-black text-white">
                  Book
                </Link>
              </div>
            </div>

            <div className="absolute bottom-4 left-4 right-4 rounded-[24px] border border-white/70 bg-white/92 p-4 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-[#050505]">Live status after driver accepts</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-[#5b6776]">
                    Driver details, chat, OTP, trip progress, and receipt access.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[#eaf3ff] px-3 py-2 text-xs font-black text-[#244f9e]">
                  Tracked
                </span>
              </div>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            {trustPoints.map((point) => (
              <div key={point.label} className="rounded-[24px] border border-[#d7e2ea] bg-white p-4 shadow-sm">
                <p className="text-sm font-black text-[#050505]">{point.label}</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-[#5b6776]">{point.detail}</p>
              </div>
            ))}
          </section>

          <section className="rounded-[30px] border border-[#d7e2ea] bg-white p-5 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#5b6776]">Drive with MOOVU</p>
            <h2 className="mt-2 text-2xl font-black text-[#050505]">Earn with local trips</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#5b6776]">
              Apply to join the driver network or open the driver portal.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Link
                href="/driver/apply"
                className="inline-flex min-h-12 items-center justify-center rounded-[18px] bg-[#1f74c9] px-4 text-center text-sm font-black text-white transition active:scale-[0.99]"
              >
                Become a driver
              </Link>
              <Link
                href="/driver/login"
                className="inline-flex min-h-12 items-center justify-center rounded-[18px] border border-[#d7e2ea] bg-white px-4 text-center text-sm font-black text-[#050505] transition active:scale-[0.99]"
              >
                Driver portal
              </Link>
            </div>
          </section>

          <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 pb-4 text-xs font-bold text-[#5b6776]">
            <Link href="/privacy-policy" className="hover:text-[#1f74c9]">Privacy Policy</Link>
            <span>|</span>
            <Link href="/terms" className="hover:text-[#1f74c9]">Terms</Link>
            <span>|</span>
            <Link href="/contact" className="hover:text-[#1f74c9]">Contact</Link>
          </footer>
        </div>
      </section>

      <CustomerBottomNav />
    </main>
  );
}
