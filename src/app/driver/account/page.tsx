"use client";

import { useEffect, useMemo, useState } from "react";
import { MoovuInlineLoader } from "@/components/ui/MoovuLoadingScreen";
import Link from "next/link";
import { CarFront, CircleUserRound, FileCheck2, Headphones, LogOut, ShieldCheck, WalletCards } from "lucide-react";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import DriverSectionTabs from "@/components/app-shell/DriverSectionTabs";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { ProfileSectionCard, QuickActionGrid } from "@/components/ui/MoovuPrimitives";
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

export default function DriverAccountPage() {
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
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

  async function signOut() {
    await supabaseClient.auth.signOut({ scope: "local" });
    window.location.href = "/driver/login";
  }

  const readinessAllOk =
    (driver?.status === "approved" || driver?.status === "active") &&
    Boolean(driver?.profile_completed) &&
    (driver?.verification_status === "approved" || driver?.verification_status === "verified") &&
    Boolean(driver?.vehicle_registration);

  return (
    <main className="driver-mobile-page driver-account-v3 text-slate-950">
      {message && <CenteredMessageBox message={message} onClose={() => setMessage(null)} />}

      <div className="driver-mobile-container space-y-5">
        <header className="driver-account-heading dp-account-head">
          <div className="dp-avatar" aria-hidden="true">
            {(`${driver?.first_name?.[0] ?? ""}${driver?.last_name?.[0] ?? ""}`.toUpperCase()) || <CircleUserRound />}
          </div>
          <div className="min-w-0">
            <h1>{`${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Your account"}</h1>
            <p>
              {driver?.vehicle_registration || driver?.phone || "Driver account"}
              {" · "}
              <span className={driver?.status === "approved" || driver?.status === "active" ? "dp-ok" : "dp-wait"}>
                {driver?.status === "approved" || driver?.status === "active" ? "Approved" : "In review"}
              </span>
            </p>
          </div>
        </header>

        <DriverSectionTabs section="account" />

        <details className="dp-fold">
          <summary>
            Account checks
            <span className={readinessAllOk ? "dp-ok" : "dp-wait"}>{readinessAllOk ? "All approved" : "Needs attention"}</span>
          </summary>
          <div className="space-y-3 p-1">
            <Readiness label="Application status" value={driver?.status || "pending"} ready={driver?.status === "approved" || driver?.status === "active"} />
            <Readiness label="Profile" value={driver?.profile_completed ? "complete" : "needs attention"} ready={Boolean(driver?.profile_completed)} />
            <Readiness label="Verification" value={driver?.verification_status || "pending"} ready={driver?.verification_status === "approved" || driver?.verification_status === "verified"} />
            <Readiness label="Vehicle" value={driver?.vehicle_registration || "missing"} ready={Boolean(driver?.vehicle_registration)} />
            <p className="text-xs font-semibold leading-5 text-slate-500">
              PDP status is tracked in your application documents and does not automatically block approval.
            </p>
          </div>
        </details>

        <details className="dp-fold"><summary>Earnings and trips</summary>
        <ProfileSectionCard title="Earnings and trips" description="Totals from your completed trips.">
          {loading ? (
            <MoovuInlineLoader message="Loading earnings and trips..." />
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
        </details>

        <ProfileSectionCard title="Your details" description="What customers see when you pick them up.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Driver" value={`${driver?.first_name ?? ""} ${driver?.last_name ?? ""}`.trim() || "Driver"} />
            <Info label="Cellphone" value={driver?.phone || "Not captured"} />
            <Info label="Vehicle" value={`${driver?.vehicle_make ?? ""} ${driver?.vehicle_model ?? ""}`.trim() || "Not captured"} />
            <Info label="Number plate" value={driver?.vehicle_registration || "Not captured"} />
          </div>
        </ProfileSectionCard>

        <ProfileSectionCard title="Shortcuts" description="Money, documents, help and sign out.">
          <QuickActionGrid actions={[
            { href: "/driver/earnings", label: "Money", description: "Earnings, commission and payouts", icon: WalletCards },
            { href: "/driver/trip-offers", label: "Trip offers", description: "Received requests", icon: CarFront },
            { href: "/driver/commission-payments", label: "Commission", description: "Balance and secure online payment", icon: WalletCards },
            { href: "/driver/complete-profile", label: "Documents", description: "Profile and vehicle", icon: FileCheck2 },
            { href: "/driver", label: "Notifications", description: "Enable alerts on Home", icon: ShieldCheck },
            { href: "/driver/contact", label: "Support", description: "Contact MOOVU", icon: Headphones },
            { label: "Logout", description: "Sign out safely", onClick: signOut, icon: LogOut },
          ]} />
        </ProfileSectionCard>

        <section className="dp-delete">
          <p>Deleting your account is permanent. Records the law requires us to keep (trips, receipts, tax, safety) may be retained.</p>
          <Link href="/driver/account/delete">Delete account</Link>
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
