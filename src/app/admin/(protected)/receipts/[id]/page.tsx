"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import LoadingState from "@/components/ui/LoadingState";
import { supabaseClient } from "@/lib/supabase/client";

type ReceiptTrip = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  payment_method: string | null;
  fare_amount: number | null;
  distance_km: number | null;
  duration_min: number | null;
  status: string | null;
  created_at: string | null;
  completed_at: string | null;
  driver_id: string | null;
};

type ReceiptDriver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: string | null;
  vehicle_color: string | null;
  vehicle_registration: string | null;
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

function buildReceiptNumber(tripId: string, issueAt: string | null | undefined) {
  const shortTrip = tripId.slice(0, 8).toUpperCase();
  const datePart = issueAt
    ? new Date(issueAt).toISOString().slice(0, 10).replace(/-/g, "")
    : "00000000";
  return `MV-${datePart}-${shortTrip}`;
}

function driverName(driver: ReceiptDriver | null) {
  if (!driver) return "--";
  return [driver.first_name, driver.last_name].filter(Boolean).join(" ") || "--";
}

function statusLabel(status: string | null) {
  const value = status ?? "";
  const map: Record<string, string> = {
    completed: "Completed",
    cancelled: "Cancelled",
    ongoing: "In Progress",
    assigned: "Accepted",
    requested: "Requested",
  };
  return map[value] ?? (value || "--");
}

export default function AdminReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const tripId = params.id;

  const [trip, setTrip] = useState<ReceiptTrip | null>(null);
  const [driver, setDriver] = useState<ReceiptDriver | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const loadReceipt = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    const { data: tripRow, error: tripError } = await supabaseClient
      .from("trips")
      .select(`
        id,
        rider_name,
        rider_phone,
        pickup_address,
        dropoff_address,
        payment_method,
        fare_amount,
        distance_km,
        duration_min,
        status,
        created_at,
        completed_at,
        driver_id
      `)
      .eq("id", tripId)
      .maybeSingle();

    if (tripError) {
      setMsg(tripError.message);
      setTrip(null);
      setDriver(null);
      setLoading(false);
      return;
    }

    const typedTrip = (tripRow as ReceiptTrip | null) ?? null;
    setTrip(typedTrip);

    if (typedTrip?.driver_id) {
      const { data: driverRow } = await supabaseClient
        .from("drivers")
        .select(`
          id,
          first_name,
          last_name,
          phone,
          vehicle_make,
          vehicle_model,
          vehicle_year,
          vehicle_color,
          vehicle_registration
        `)
        .eq("id", typedTrip.driver_id)
        .maybeSingle();

      setDriver((driverRow as ReceiptDriver | null) ?? null);
    } else {
      setDriver(null);
    }

    setLoading(false);
  }, [tripId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReceipt();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReceipt]);

  const issueAt = trip?.completed_at ?? trip?.created_at ?? null;
  const totalPaid = Number(trip?.fare_amount ?? 0);
  const vatAmount = useMemo(() => totalPaid - totalPaid / 1.15, [totalPaid]);
  const fareExclVat = useMemo(() => totalPaid / 1.15, [totalPaid]);
  const receiptNumber = useMemo(
    () => buildReceiptNumber(trip?.id ?? "", issueAt),
    [trip?.id, issueAt]
  );

  const vehicleLabel = useMemo(() => {
    if (!driver) return "--";
    return [driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(" ") || "--";
  }, [driver]);

  if (loading) {
    return <LoadingState title="Loading receipt" description="Preparing the admin receipt view." />;
  }

  if (!trip) {
    return (
      <main className="space-y-5">
        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
        <section className="moovu-card p-6">
          <div className="moovu-section-title">Receipt</div>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Receipt not found</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            We could not find a receipt for this trip. Return to the receipts list and try again.
          </p>
          <Link href="/admin/receipts" className="moovu-btn moovu-btn-primary mt-5">
            Back to receipts
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="space-y-5 moovu-receipt-screen">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="moovu-section-title">Receipt</div>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">
            Trip receipt
          </h1>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/admin/receipts" className="moovu-btn moovu-btn-secondary">
            Back to receipts
          </Link>
          <button type="button" onClick={() => window.print()} className="moovu-btn moovu-btn-primary">
            Print receipt
          </button>
        </div>
      </div>

      <div className="moovu-receipt-doc">
        <div className="moovu-receipt-doc-header">
          <div className="moovu-receipt-logo-row">
            <Image
              src="/logo.png"
              alt="MOOVU Kasi Rides"
              width={64}
              height={64}
              priority
              className="moovu-receipt-logo-img"
            />
            <div>
              <div className="moovu-receipt-brand">MOOVU Kasi Rides</div>
              <div className="moovu-receipt-tagline">Safe · Fast · Trusted</div>
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
                  <td>Trip ID</td>
                  <td className="moovu-receipt-mono">{trip.id}</td>
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
          <div className="moovu-receipt-route-row">
            <div className="moovu-receipt-route-icon dropoff" />
            <div>
              <div className="moovu-receipt-route-label">Destination</div>
              <div className="moovu-receipt-route-value">{dash(trip.dropoff_address)}</div>
            </div>
          </div>
        </div>

        <div className="moovu-receipt-divider" />

        <div className="moovu-receipt-stats">
          <div className="moovu-receipt-stat">
            <div className="moovu-receipt-stat-label">Distance</div>
            <div className="moovu-receipt-stat-value">{fmtNum(trip.distance_km, "km")}</div>
          </div>
          <div className="moovu-receipt-stat">
            <div className="moovu-receipt-stat-label">Duration</div>
            <div className="moovu-receipt-stat-value">{fmtNum(trip.duration_min, "min")}</div>
          </div>
          <div className="moovu-receipt-stat">
            <div className="moovu-receipt-stat-label">Payment</div>
            <div className="moovu-receipt-stat-value">{dash(trip.payment_method)}</div>
          </div>
        </div>

        <div className="moovu-receipt-divider" />

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
                .join(" · ") || "--"}
            </div>
          </div>
        </div>

        <div className="moovu-receipt-divider" />

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

        <div className="moovu-receipt-fare-block">
          <div className="moovu-receipt-fare-row">
            <span>Trip fare (excl. VAT)</span>
            <span>{money(fareExclVat)}</span>
          </div>
          <div className="moovu-receipt-fare-row">
            <span>VAT (15%)</span>
            <span>{money(vatAmount)}</span>
          </div>
          <div className="moovu-receipt-fare-total-row">
            <span>TOTAL PAID</span>
            <span>{money(totalPaid)}</span>
          </div>
        </div>

        <div className="moovu-receipt-doc-footer">
          Thank you for riding with MOOVU Kasi Rides.
        </div>
      </div>
    </main>
  );
}
