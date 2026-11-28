"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Download } from "lucide-react";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import CustomerBackHomeNav from "@/components/app-shell/CustomerBackHomeNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import MoovuLoadingScreen from "@/components/customer/MoovuLoadingScreen";
import { supabaseClient } from "@/lib/supabase/client";
import { formatFareRands } from "@/lib/pricing/fareDisplay";

type Trip = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  payment_method: string | null;
  fare_amount: number | null;
  final_fare?: number | null;
  original_fare?: number | null;
  final_add_stop_increase?: number | null;
  stop_waiting_fee?: number | null;
  ride_type?: string | null;
  stops?: unknown;
  distance_km?: number | null;
  duration_min?: number | null;
  actual_distance_km?: number | null;
  actual_duration_min?: number | null;
  actual_fare_breakdown?: {
    baseFare?: number;
    distanceKm?: number;
    perKm?: number;
    durationMin?: number;
    perMinute?: number;
    bookingFee?: number;
    waitingFee?: number;
    distanceDiscountPct?: number;
    distanceDiscountAmount?: number;
    fareBeforeDistanceDiscount?: number;
  } | null;
  fare_breakdown?: {
    journeyFare?: {
      distanceDiscountPct?: number;
      distanceDiscountAmount?: number;
      fareBeforeDistanceDiscount?: number;
    } | null;
  } | null;
  status: string;
  created_at: string | null;
  completed_at?: string | null;
  driver_id: string | null;
};

type Driver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  vehicle_color?: string | null;
  vehicle_registration?: string | null;
};

type TripStatusResponse = {
  ok?: boolean;
  trip?: Trip | null;
  driver?: Driver | null;
  error?: string;
};

type ReceiptStop = {
  address: string;
};

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function dash(value: string | null | undefined) {
  return value?.trim() || "--";
}

function fmt(value: string | null | undefined) {
  if (!value) return "--";
  return new Date(value).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtNum(value: number | null | undefined, suffix: string) {
  if (value == null) return "--";
  return `${Number(value).toFixed(value % 1 === 0 ? 0 : 1)} ${suffix}`;
}

function rideTypeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "group" || normalized === "xl" || normalized.includes("xl")) return "MOOVU Go XL";
  if (normalized === "scheduled") return "Scheduled ride";
  return "MOOVU Go";
}

function buildReceiptNumber(tripId: string, issueAt: string | null | undefined) {
  const shortTrip = tripId.slice(0, 8).toUpperCase();
  const datePart = issueAt
    ? new Date(issueAt).toISOString().slice(0, 10).replace(/-/g, "")
    : "00000000";
  return `MV-${datePart}-${shortTrip}`;
}

function driverName(driver: Driver | null) {
  if (!driver) return "--";
  return [driver.first_name, driver.last_name].filter(Boolean).join(" ") || "--";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    completed: "Completed",
    cancelled: "Cancelled",
    in_progress: "In Progress",
    accepted: "Accepted",
    pending: "Pending",
  };
  return map[status] ?? status;
}

export default function TripReceiptPage() {
  const router = useRouter();
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const loadReceipt = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();

      if (!session) {
        router.replace(`/customer/auth?next=/ride/${tripId}/receipt`);
        return;
      }

      const res = await fetch(`/api/customer/trip-status?tripId=${encodeURIComponent(tripId)}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const json = (await res.json().catch(() => null)) as TripStatusResponse | null;

      if (!json?.ok) {
        setMsg(json?.error || "Could not load receipt.");
        setLoading(false);
        return;
      }

      setTrip(json.trip ?? null);
      setDriver(json.driver ?? null);
    } catch (error: unknown) {
      setMsg(error instanceof Error ? error.message : "Could not load receipt.");
    }

    setLoading(false);
  }, [router, tripId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadReceipt(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReceipt]);

  const issueAt = trip?.completed_at ?? trip?.created_at ?? null;
  const totalPaid = Number(trip?.final_fare ?? trip?.fare_amount ?? 0);
  const receiptNumber = useMemo(() => buildReceiptNumber(trip?.id ?? "", issueAt), [trip?.id, issueAt]);
  const receiptStops: ReceiptStop[] = Array.isArray(trip?.stops)
    ? trip.stops
        .slice(0, 2)
        .map((stop) => {
          const item = (stop ?? {}) as { address?: unknown };
          return { address: typeof item.address === "string" ? item.address : "" };
        })
        .filter((stop) => stop.address.trim())
    : [];
  async function shareReceipt() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: `MOOVU receipt ${receiptNumber}`, text: "Your MOOVU ride receipt", url });
      return;
    }
    await navigator.clipboard.writeText(url);
    setMsg("Receipt link copied.");
  }

  if (loading) {
    return <MoovuLoadingScreen message="Preparing your receipt..." />;
  }

  if (!trip) {
    return (
      <main className="moovu-app-screen">
        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
        <div className="moovu-app-container">
          <section className="moovu-app-card p-6">
            <div className="moovu-kicker">Receipt</div>
            <h1 className="mt-2 text-2xl font-black text-slate-950">Receipt not found</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              We could not find a receipt for this trip. Open your ride history and try again.
            </p>
            <Link href="/ride/history" className="moovu-btn moovu-btn-primary mt-5">
              Back to trips
            </Link>
          </section>
        </div>
        <CustomerBottomNav />
      </main>
    );
  }

  const bookingFee = Number(trip.actual_fare_breakdown?.bookingFee ?? 0);
  const extras = Number(trip.stop_waiting_fee ?? 0) + Number(trip.final_add_stop_increase ?? 0);
  const rideFare = Math.max(0, totalPaid - bookingFee - extras);
  const car = [driver?.vehicle_color, driver?.vehicle_make, driver?.vehicle_model].filter(Boolean).join(" ");
  const shortDriver = driver ? [driver.first_name, driver.last_name ? `${driver.last_name.trim().charAt(0)}.` : ""].filter(Boolean).join(" ") : "--";
  const time = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : "--";
  const date = issueAt ? new Date(issueAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "--";
  const paidBy = String(trip.payment_method ?? "").toLowerCase().includes("cash") ? "Cash" : "Card";

  return (
    <main className="moovu-app-screen moovu-receipt-screen rc-screen">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="rc-wrap">
        <div className="moovu-no-print rc-toolbar">
          <CustomerBackHomeNav fallbackHref={`/ride/${trip.id}`} homeHref="/book" homeLabel="Book ride" compact />
        </div>

        <article className="rc-card">
          <header className="rc-head">
            <Image src="/logo.png" alt="MOOVU" width={36} height={36} priority className="rc-logo" />
            <span className="rc-brand">MOOVU</span>
          </header>

          <h1 className="rc-title">Trip Receipt</h1>
          <div className="rc-name">{dash(trip.rider_name)}</div>
          <div className="rc-muted">{statusLabel(trip.status)} · {rideTypeLabel(trip.ride_type)}</div>

          <hr className="rc-rule" />

          <div className="rc-grid3">
            <div><span>Date</span><b>{date}</b></div>
            <div><span>Booked</span><b>{time(trip.created_at)}</b></div>
            <div><span>Arrived</span><b>{time(trip.completed_at)}</b></div>
          </div>
          <div className="rc-grid2">
            <div><span>From</span><b>{dash(trip.pickup_address)}</b></div>
            <div><span>To</span><b>{dash(trip.dropoff_address)}</b></div>
          </div>
          <div className="rc-grid2">
            <div><span>Driver</span><b>{shortDriver}</b>{car && <em>{car}</em>}</div>
            <div><span>Car</span><b>{dash(driver?.vehicle_registration)}</b><em>{fmtNum(trip.actual_distance_km ?? trip.distance_km, "km")} · {fmtNum(trip.actual_duration_min ?? trip.duration_min, "min")}</em></div>
          </div>

          <section className="rc-total">
            <div className="rc-total-top"><span>Total paid · {paidBy}</span><b>{formatFareRands(totalPaid)}</b></div>
            {(bookingFee > 0 || extras > 0) && (
              <div className="rc-lines">
                <div><span>Ride fare</span><span>{money(rideFare)}</span></div>
                {extras > 0 && <div><span>Stops &amp; waiting</span><span>{money(extras)}</span></div>}
                {bookingFee > 0 && <div><span>Booking fee</span><span>{money(bookingFee)}</span></div>}
              </div>
            )}
          </section>

          <p className="rc-thanks">Thank you for riding with <strong>MOOVU</strong>. Need help with this trip? Message us on WhatsApp from the app.</p>
          <footer className="rc-foot">Receipt {receiptNumber}</footer>
        </article>

        <div className="moovu-no-print rc-actions">
          <button type="button" className="rc-btn" onClick={() => void shareReceipt()}>Share</button>
          <button type="button" className="rc-btn is-primary" onClick={() => window.print()}><Download aria-hidden="true" size={18} />Download PDF</button>
        </div>
      </div>
    </main>
  );
}
