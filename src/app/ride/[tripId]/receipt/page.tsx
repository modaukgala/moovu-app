"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import LoadingState from "@/components/ui/LoadingState";
import { supabaseClient } from "@/lib/supabase/client";

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
  const vatAmount = useMemo(() => totalPaid - totalPaid / 1.15, [totalPaid]);
  const fareExclVat = useMemo(() => totalPaid / 1.15, [totalPaid]);
  const receiptNumber = useMemo(() => buildReceiptNumber(trip?.id ?? "", issueAt), [trip?.id, issueAt]);
  const receiptStops = useMemo<ReceiptStop[]>(() => {
    if (!Array.isArray(trip?.stops)) return [];
    return trip.stops
      .slice(0, 2)
      .map((stop) => {
        const item = (stop ?? {}) as { address?: unknown };
        return { address: typeof item.address === "string" ? item.address : "" };
      })
      .filter((stop) => stop.address.trim());
  }, [trip?.stops]);
  const routeAddition = useMemo(
    () => Number(trip?.final_add_stop_increase ?? 0) + Number(trip?.stop_waiting_fee ?? 0),
    [trip?.final_add_stop_increase, trip?.stop_waiting_fee]
  );

  const vehicleLabel = useMemo(() => {
    if (!driver) return "--";
    return [driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(" ") || "--";
  }, [driver]);

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
    return <LoadingState title="Loading receipt" description="Preparing your MOOVU trip receipt." />;
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

  return (
    <main className="moovu-app-screen moovu-receipt-screen">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-app-container">
        {/* Print controls */}
        <div className="moovu-no-print mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link href={`/ride/${trip.id}`} className="moovu-btn moovu-btn-secondary">
            Back to trip
          </Link>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void shareReceipt()} className="moovu-btn moovu-btn-secondary">
              Share
            </button>
            <button type="button" onClick={() => window.print()} className="moovu-btn moovu-btn-primary">
              Print / Save PDF
            </button>
          </div>
        </div>

        <div className="moovu-receipt-doc">
          {/* HEADER */}
          <div className="moovu-receipt-doc-header">
            <div className="moovu-receipt-logo-row">
              <Image src="/logo.png" alt="MOOVU Kasi Rides" width={64} height={64} priority className="moovu-receipt-logo-img" />
              <div>
                <div className="moovu-receipt-brand">MOOVU Kasi Rides</div>
                <div className="moovu-receipt-tagline">Safe - Fast - Trusted</div>
              </div>
            </div>
            <div className="moovu-receipt-doc-meta">
              <div className="moovu-receipt-title">TRIP RECEIPT</div>
              <table className="moovu-receipt-meta-table">
                <tbody>
                  <tr>
                    <td>Receipt No.</td>
                    <td><strong>{receiptNumber}</strong></td>
                  </tr>
                  <tr>
                    <td>Issued</td>
                    <td>{fmt(issueAt)}</td>
                  </tr>
                  <tr>
                    <td>Status</td>
                    <td>
                      <span className={`moovu-receipt-status moovu-receipt-status-${trip.status}`}>
                        {statusLabel(trip.status)}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="moovu-receipt-divider" />

          {/* ROUTE */}
          <div className="moovu-receipt-section-title">Route</div>
          <div className="moovu-receipt-route">
            <div className="moovu-receipt-route-row">
              <div className="moovu-receipt-route-icon pickup" />
              <div>
                <div className="moovu-receipt-route-label">Pickup</div>
                <div className="moovu-receipt-route-value">{dash(trip.pickup_address)}</div>
              </div>
            </div>
            <div className="moovu-receipt-route-connector" />
            {receiptStops.map((stop, index) => (
              <div key={`${stop.address}-${index}`}>
                <div className="moovu-receipt-route-row">
                  <div className="moovu-receipt-route-icon stop">{index + 1}</div>
                  <div>
                    <div className="moovu-receipt-route-label">Stop {index + 1}</div>
                    <div className="moovu-receipt-route-value">{dash(stop.address)}</div>
                  </div>
                </div>
                <div className="moovu-receipt-route-connector" />
              </div>
            ))}
            <div className="moovu-receipt-route-row">
              <div className="moovu-receipt-route-icon dropoff" />
              <div>
                <div className="moovu-receipt-route-label">Destination</div>
                <div className="moovu-receipt-route-value">{dash(trip.dropoff_address)}</div>
              </div>
            </div>
          </div>

          <div className="moovu-receipt-divider" />

          {/* TRIP STATS */}
          <div className="moovu-receipt-stats">
            <div className="moovu-receipt-stat">
              <div className="moovu-receipt-stat-label">Ride type</div>
              <div className="moovu-receipt-stat-value">{rideTypeLabel(trip.ride_type)}</div>
            </div>
            <div className="moovu-receipt-stat">
              <div className="moovu-receipt-stat-label">Distance</div>
              <div className="moovu-receipt-stat-value">{fmtNum(trip.actual_distance_km ?? trip.distance_km, "km")}</div>
            </div>
            <div className="moovu-receipt-stat">
              <div className="moovu-receipt-stat-label">Duration</div>
              <div className="moovu-receipt-stat-value">{fmtNum(trip.actual_duration_min ?? trip.duration_min, "min")}</div>
            </div>
            <div className="moovu-receipt-stat">
              <div className="moovu-receipt-stat-label">Payment</div>
              <div className="moovu-receipt-stat-value">{dash(trip.payment_method)}</div>
            </div>
          </div>

          <div className="moovu-receipt-divider" />

          {/* PEOPLE + VEHICLE */}
          <div className="moovu-receipt-people">
            <div>
              <div className="moovu-receipt-section-title">Rider</div>
              <div className="moovu-receipt-person-name">{dash(trip.rider_name)}</div>
              <div className="moovu-receipt-person-sub">{dash(trip.rider_phone)}</div>
            </div>
            <div>
              <div className="moovu-receipt-section-title">Driver</div>
              <div className="moovu-receipt-person-name">{driverName(driver)}</div>
              <div className="moovu-receipt-person-sub">{dash(driver?.phone)}</div>
            </div>
            <div>
              <div className="moovu-receipt-section-title">Vehicle</div>
              <div className="moovu-receipt-person-name">{vehicleLabel}</div>
              <div className="moovu-receipt-person-sub">
                {[driver?.vehicle_year, driver?.vehicle_color, driver?.vehicle_registration]
                  .filter(Boolean)
                  .join(" - ") || "--"}
              </div>
            </div>
          </div>

          <div className="moovu-receipt-divider" />

          {/* TIMESTAMPS */}
          <div className="moovu-receipt-times">
            <div>
              <span className="moovu-receipt-time-label">Booked:</span>
              <span>{fmt(trip.created_at)}</span>
            </div>
            <div>
              <span className="moovu-receipt-time-label">Completed:</span>
              <span>{fmt(trip.completed_at)}</span>
            </div>
          </div>

          <div className="moovu-receipt-divider" />

          {/* FARE TOTAL */}
          <div className="moovu-receipt-fare-block">
            {trip.actual_fare_breakdown?.baseFare != null && (
              <div className="moovu-receipt-fare-row">
                <span>Base fare</span>
                <span>{money(trip.actual_fare_breakdown.baseFare)}</span>
              </div>
            )}
            {trip.actual_fare_breakdown?.distanceKm != null && (
              <div className="moovu-receipt-fare-row">
                <span>Distance fare</span>
                <span>{money(Number(trip.actual_fare_breakdown.distanceKm) * Number(trip.actual_fare_breakdown.perKm ?? 0))}</span>
              </div>
            )}
            {trip.actual_fare_breakdown?.durationMin != null && (
              <div className="moovu-receipt-fare-row">
                <span>Time fare</span>
                <span>{money(Number(trip.actual_fare_breakdown.durationMin) * Number(trip.actual_fare_breakdown.perMinute ?? 0))}</span>
              </div>
            )}
            <div className="moovu-receipt-fare-row">
              <span>Trip fare (excl. VAT)</span>
              <span>{money(fareExclVat)}</span>
            </div>
            <div className="moovu-receipt-fare-row">
              <span>VAT (15%)</span>
              <span>{money(vatAmount)}</span>
            </div>
            {Number(trip.original_fare ?? 0) > 0 && (
              <div className="moovu-receipt-fare-row">
                <span>Original route estimate</span>
                <span>{money(trip.original_fare)}</span>
              </div>
            )}
            {Number(trip.final_add_stop_increase ?? 0) > 0 && (
              <div className="moovu-receipt-fare-row">
                <span>Add-stop route increase</span>
                <span>{money(trip.final_add_stop_increase)}</span>
              </div>
            )}
            {Number(trip.stop_waiting_fee ?? 0) > 0 && (
              <div className="moovu-receipt-fare-row">
                <span>Stop waiting fee</span>
                <span>{money(trip.stop_waiting_fee)}</span>
              </div>
            )}
            {routeAddition > 0 && (
              <div className="moovu-receipt-fare-row">
                <span>Add-stop discount applied</span>
                <span>40%</span>
              </div>
            )}
            <div className="moovu-receipt-fare-total-row">
              <span>TOTAL PAID</span>
              <span>{money(totalPaid)}</span>
            </div>
          </div>

          {/* FOOTER */}
          <div className="moovu-receipt-doc-footer">
            <strong>Thank you for choosing MOOVU.</strong>
            <span>admin@moovurides.co.za · moovurides.co.za</span>
          </div>
        </div>
      </div>

      <CustomerBottomNav />
    </main>
  );
}
