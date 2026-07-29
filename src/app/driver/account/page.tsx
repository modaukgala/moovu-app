"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CarFront, ChevronRight, CircleUserRound, FileCheck2, Headphones, LogOut, ShieldCheck, WalletCards } from "lucide-react";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import StatusBadge from "@/components/ui/StatusBadge";
import { ProfileSectionCard, QuickActionGrid } from "@/components/ui/MoovuPrimitives";
import { DRIVER_SUBSCRIPTION_PLANS, type DriverSubscriptionPlan } from "@/lib/finance/driverPayments";
import { supabaseClient } from "@/lib/supabase/client";

type DriverProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string | null;
  verification_status?: string | null;
  profile_completed?: boolean | null;
  subscription_status?: string | null;
  subscription_plan?: string | null;
  subscription_expires_at?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_registration?: string | null;
};

type CompletedTrip = {
  id: string;
  fare_amount: number | null;
  commission_amount: number | null;
  driver_net_earnings: number | null;
  completed_at: string | null;
};

type EarningsData = {
  driver?: {
    subscription_last_paid_at?: string | null;
    subscription_expires_at?: string | null;
  } | null;
  wallet?: {
    balance_due?: number | null;
    total_commission?: number | null;
    total_driver_net?: number | null;
    total_trips_completed?: number | null;
  } | null;
  recent_completed_trips?: CompletedTrip[];
  settlements?: Array<{ id: string; amount_paid?: number | null; created_at?: string | null }>;
};

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return `R${num(value).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not available";
}

function planName(value: string | null | undefined) {
  if (value && value in DRIVER_SUBSCRIPTION_PLANS) {
    return DRIVER_SUBSCRIPTION_PLANS[value as DriverSubscriptionPlan].label;
  }
  return "No active plan";
}

export default function DriverAccountPage() {
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  const [loadedAt] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDriver() {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) {
        window.location.href = "/driver/login?next=/driver/account";
        return;
      }

      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [profileResponse, earningsResponse] = await Promise.all([
        fetch("/api/driver/me", { headers, cache: "no-store" }),
        fetch("/api/driver/earnings", { headers, cache: "no-store" }),
      ]);
      const [profileJson, earningsJson] = await Promise.all([
        profileResponse.json().catch(() => null),
        earningsResponse.json().catch(() => null),
      ]);

      if (cancelled) return;
      if (profileResponse.ok && profileJson?.ok) setDriver(profileJson.driver);
      else setMessage(profileJson?.error || "Could not load your driver account.");
      if (earningsResponse.ok && earningsJson?.ok) setEarnings(earningsJson.earnings);
      else if (profileResponse.ok) setMessage(earningsJson?.error || "Could not load account totals.");
      setLoading(false);
    }

    void loadDriver();
    return () => { cancelled = true; };
  }, []);

  const snapshot = useMemo(() => {
    const now = new Date();
    const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const trips = earnings?.recent_completed_trips ?? [];
    const net = (trip: CompletedTrip) => trip.driver_net_earnings != null
      ? num(trip.driver_net_earnings)
      : Math.max(0, num(trip.fare_amount) - num(trip.commission_amount));
    const isToday = (value: string | null) => value && new Date(value).toDateString() === now.toDateString();
    const isWeek = (value: string | null) => value && new Date(value).getTime() >= weekStart;
    const isMonth = (value: string | null) => {
      if (!value) return false;
      const date = new Date(value);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    };
    const todayTrips = trips.filter((trip) => isToday(trip.completed_at));
    const weekTrips = trips.filter((trip) => isWeek(trip.completed_at));
    const monthTrips = trips.filter((trip) => isMonth(trip.completed_at));

    return {
      today: todayTrips.reduce((sum, trip) => sum + net(trip), 0),
      week: weekTrips.reduce((sum, trip) => sum + net(trip), 0),
      month: monthTrips.reduce((sum, trip) => sum + net(trip), 0),
      todayTrips: todayTrips.length,
      weekTrips: weekTrips.length,
      gross: trips.reduce((sum, trip) => sum + num(trip.fare_amount), 0),
      net: earnings?.wallet?.total_driver_net ?? trips.reduce((sum, trip) => sum + net(trip), 0),
    };
  }, [earnings]);

  const expiry = driver?.subscription_expires_at ?? earnings?.driver?.subscription_expires_at;
  const remaining = expiry
    ? Math.max(0, Math.ceil((new Date(expiry).getTime() - loadedAt) / (24 * 60 * 60 * 1000)))
    : 0;

  async function signOut() {
    await supabaseClient.auth.signOut({ scope: "local" });
    window.location.href = "/driver/login";
  }

  return (
    <main className="driver-mobile-page driver-account-v3 text-slate-950">
      {message && <CenteredMessageBox message={message} onClose={() => setMessage(null)} />}

      <div className="driver-mobile-container space-y-5">
        <header className="driver-account-heading">
          <div className="driver-account-avatar"><CircleUserRound aria-hidden="true" /></div>
          <div>
            <span>MOOVU Driver</span>
            <h1>{`${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Your account"}</h1>
            <p>{driver?.phone || "Manage your driver profile and access"}</p>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="moovu-card driver-account-subscription p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="moovu-section-title">Subscription</div>
                <h2 className="mt-2 text-2xl font-black">{planName(driver?.subscription_plan)}</h2>
              </div>
              <StatusBadge status={driver?.subscription_status || "inactive"} />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Info label="Started / last paid" value={displayDate(earnings?.driver?.subscription_last_paid_at)} />
              <Info label="Expires" value={displayDate(expiry)} />
              <Info label="Time remaining" value={`${remaining} day${remaining === 1 ? "" : "s"}`} />
              <Info label="Commission owed" value={money(earnings?.wallet?.balance_due)} />
            </div>
            <Link href="/driver/subscriptions" className="moovu-btn moovu-btn-primary mt-5">
              Renew or change plan <ChevronRight aria-hidden="true" />
            </Link>
          </div>

          <div className="moovu-card driver-account-readiness p-5 sm:p-6">
            <div className="moovu-section-title">Driver readiness</div>
            <h2 className="mt-2 text-2xl font-black">Account checks</h2>
            <div className="mt-5 space-y-3">
              <Readiness label="Application status" value={driver?.status || "pending"} ready={driver?.status === "approved" || driver?.status === "active"} />
              <Readiness label="Profile" value={driver?.profile_completed ? "complete" : "needs attention"} ready={Boolean(driver?.profile_completed)} />
              <Readiness label="Verification" value={driver?.verification_status || "pending"} ready={driver?.verification_status === "approved" || driver?.verification_status === "verified"} />
              <Readiness label="Vehicle" value={driver?.vehicle_registration || "missing"} ready={Boolean(driver?.vehicle_registration)} />
            </div>
            <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">
              PDP status is tracked in your application documents and does not automatically block approval.
            </p>
          </div>
        </section>

        <ProfileSectionCard title="Earnings and trips" description="Totals are calculated from your existing completed-trip and wallet records.">
          {loading ? (
            <div className="moovu-premium-skeleton-stack" aria-hidden="true"><div className="moovu-skeleton h-24 w-full" /></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Info label="Today" value={money(snapshot.today)} />
              <Info label="This week" value={money(snapshot.week)} />
              <Info label="This month" value={money(snapshot.month)} />
              <Info label="Lifetime net" value={money(snapshot.net)} />
              <Info label="Trips today" value={String(snapshot.todayTrips)} />
              <Info label="Trips this week" value={String(snapshot.weekTrips)} />
              <Info label="Total completed" value={String(earnings?.wallet?.total_trips_completed ?? 0)} />
              <Info label="Gross recorded" value={money(snapshot.gross)} />
            </div>
          )}
        </ProfileSectionCard>

        <ProfileSectionCard title="Driver profile" description="Customer-facing vehicle details and secure account information.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Driver" value={`${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver"} />
            <Info label="Cellphone" value={driver?.phone || "Not captured"} />
            <Info label="Vehicle" value={`${driver?.vehicle_make ?? ""} ${driver?.vehicle_model ?? ""}`.trim() || "Not captured"} />
            <Info label="Number plate" value={driver?.vehicle_registration || "Not captured"} />
          </div>
        </ProfileSectionCard>

        <ProfileSectionCard title="Quick actions" description="Open the areas used for daily driving, payments, documents, and support.">
          <QuickActionGrid actions={[
            { href: "/driver/subscriptions", label: "Subscription", description: "Plan and payment history", icon: WalletCards },
            { href: "/driver/earnings", label: "Earnings", description: "Trips and totals", icon: WalletCards },
            { href: "/driver/trip-offers", label: "Trip offers", description: "Received requests", icon: CarFront },
            { href: "/driver/commission-payments", label: "Commission", description: "Balance and POP", icon: WalletCards },
            { href: "/driver/complete-profile", label: "Documents", description: "Profile and vehicle", icon: FileCheck2 },
            { href: "/driver", label: "Notifications", description: "Enable alerts on Home", icon: ShieldCheck },
            { href: "/driver/contact", label: "Support", description: "Contact MOOVU", icon: Headphones },
            { label: "Logout", description: "Sign out safely", onClick: signOut, icon: LogOut },
          ]} />
        </ProfileSectionCard>

        <section className="moovu-card border border-red-100 bg-red-50/50 p-5 sm:p-7">
          <div className="moovu-section-title text-red-700">Delete account</div>
          <h2 className="mt-2 text-2xl font-black">Delete Account</h2>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            Permanently delete your driver account. Legally required trip, receipt, tax, fraud-prevention, and safety records may be retained.
          </p>
          <Link href="/driver/account/delete" className="moovu-btn mt-5 bg-red-600 text-white">Delete Account</Link>
        </section>
      </div>

      <DriverBottomNav />
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="moovu-data-row">
      <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-slate-950">{value}</div>
    </div>
  );
}

function Readiness({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <span className={ready ? "text-xs font-black uppercase text-emerald-700" : "text-xs font-black uppercase text-amber-700"}>{value}</span>
    </div>
  );
}
