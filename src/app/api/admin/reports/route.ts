import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

type TripRow = {
  id: string;
  driver_id: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  status: string | null;
  created_at: string | null;
  commission_amount?: number | null;
  driver_net_earnings?: number | null;
};

type DriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
};

type CancellationFeeRow = {
  driver_id: string | null;
  fee_type: string | null;
  fee_amount: number | string | null;
  driver_amount: number | string | null;
  moovu_amount: number | string | null;
  created_at: string | null;
};

function num(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { supabaseAdmin } = auth;
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    let completedQuery = supabaseAdmin
      .from("trips")
      .select(`
        id,
        driver_id,
        fare_amount,
        payment_method,
        pickup_address,
        dropoff_address,
        status,
        created_at,
        commission_amount,
        driver_net_earnings
      `)
      .eq("status", "completed")
      .order("created_at", { ascending: false });

    let inProgressQuery = supabaseAdmin
      .from("trips")
      .select(`
        id,
        driver_id,
        fare_amount,
        payment_method,
        pickup_address,
        dropoff_address,
        status,
        created_at,
        commission_amount,
        driver_net_earnings
      `)
      .in("status", ["assigned", "arrived", "ongoing"])
      .order("created_at", { ascending: false });

    if (from) {
      completedQuery = completedQuery.gte("created_at", `${from}T00:00:00`);
      inProgressQuery = inProgressQuery.gte("created_at", `${from}T00:00:00`);
    }

    if (to) {
      completedQuery = completedQuery.lte("created_at", `${to}T23:59:59`);
      inProgressQuery = inProgressQuery.lte("created_at", `${to}T23:59:59`);
    }

    let cancellationQuery = supabaseAdmin
      .from("trip_cancellation_fees")
      .select("driver_id,fee_type,fee_amount,driver_amount,moovu_amount,created_at")
      .order("created_at", { ascending: false });

    if (from) {
      cancellationQuery = cancellationQuery.gte("created_at", `${from}T00:00:00`);
    }

    if (to) {
      cancellationQuery = cancellationQuery.lte("created_at", `${to}T23:59:59`);
    }

    const [
      { data: completed, error: completedErr },
      { data: inProgress, error: inProgressErr },
      { data: drivers, error: driversErr },
      { data: cancellationFees, error: cancellationErr },
    ] =
      await Promise.all([
        completedQuery,
        inProgressQuery,
        supabaseAdmin.from("drivers").select("id,first_name,last_name,phone"),
        cancellationQuery,
      ]);

    if (completedErr) {
      return NextResponse.json(
        { ok: false, error: completedErr.message },
        { status: 500 }
      );
    }

    if (inProgressErr) {
      return NextResponse.json(
        { ok: false, error: inProgressErr.message },
        { status: 500 }
      );
    }

    if (driversErr) {
      return NextResponse.json(
        { ok: false, error: driversErr.message },
        { status: 500 }
      );
    }

    if (cancellationErr) {
      console.error("[admin-reports] cancellation fee lookup failed", {
        reason: cancellationErr.message,
      });
    }

    const driverNameById = new Map<string, string>();
    for (const d of (drivers ?? []) as DriverRow[]) {
      const fullName = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim();
      driverNameById.set(d.id, fullName || d.phone || d.id);
    }

    const completedTrips = ((completed ?? []) as TripRow[]).map((trip) => ({
      ...trip,
      driver_name: trip.driver_id ? driverNameById.get(trip.driver_id) ?? trip.driver_id : null,
    }));

    const inProgressTrips = ((inProgress ?? []) as TripRow[]).map((trip) => ({
      ...trip,
      driver_name: trip.driver_id ? driverNameById.get(trip.driver_id) ?? trip.driver_id : null,
    }));

    const typedCancellationFees = (cancellationErr ? [] : (cancellationFees ?? [])) as CancellationFeeRow[];
    const lateCancellationFees = typedCancellationFees.filter((row) => row.fee_type === "late_cancel");
    const noShowFees = typedCancellationFees.filter((row) => row.fee_type === "no_show");
    const cancellationFeeTotal = lateCancellationFees.reduce((sum, row) => sum + num(row.fee_amount), 0);
    const noShowFeeTotal = noShowFees.reduce((sum, row) => sum + num(row.fee_amount), 0);
    const cancellationDriverPayouts = typedCancellationFees.reduce((sum, row) => sum + num(row.driver_amount), 0);
    const cancellationMoovuRevenue = typedCancellationFees.reduce((sum, row) => sum + num(row.moovu_amount), 0);

    const totals = {
      completedTrips: completedTrips.length,
      completedRevenue: completedTrips.reduce((s, t) => s + num(t.fare_amount), 0),
      completedCommission: completedTrips.reduce((s, t) => s + num(t.commission_amount), 0),
      completedDriverNet: completedTrips.reduce((s, t) => s + num(t.driver_net_earnings), 0),
      inProgressTrips: inProgressTrips.length,
      inProgressValue: inProgressTrips.reduce((s, t) => s + num(t.fare_amount), 0),
      lateCancellationFees: cancellationFeeTotal,
      noShowFees: noShowFeeTotal,
      cancellationDriverPayouts,
      cancellationMoovuRevenue,
    };

    const byDriverMap = new Map<
      string,
      {
        driver_id: string;
        driver_name: string;
        completed_trips: number;
        completed_revenue: number;
        completed_commission: number;
        completed_driver_net: number;
        cancellation_driver_payouts: number;
      }
    >();

    for (const trip of completedTrips) {
      if (!trip.driver_id) continue;

      const row =
        byDriverMap.get(trip.driver_id) ??
        {
          driver_id: trip.driver_id,
          driver_name: trip.driver_id ? driverNameById.get(trip.driver_id) ?? trip.driver_id : "—",
          completed_trips: 0,
          completed_revenue: 0,
          completed_commission: 0,
          completed_driver_net: 0,
          cancellation_driver_payouts: 0,
        };

      row.completed_trips += 1;
      row.completed_revenue += num(trip.fare_amount);
      row.completed_commission += num(trip.commission_amount);
      row.completed_driver_net += num(trip.driver_net_earnings);

      byDriverMap.set(trip.driver_id, row);
    }

    for (const fee of typedCancellationFees) {
      const driverId = String(fee.driver_id ?? "").trim();
      if (!driverId) continue;

      const row =
        byDriverMap.get(driverId) ??
        {
          driver_id: driverId,
          driver_name: driverNameById.get(driverId) ?? driverId,
          completed_trips: 0,
          completed_revenue: 0,
          completed_commission: 0,
          completed_driver_net: 0,
          cancellation_driver_payouts: 0,
        };

      row.cancellation_driver_payouts += num(fee.driver_amount);
      byDriverMap.set(driverId, row);
    }

    return NextResponse.json({
      ok: true,
      report: {
        completed: completedTrips,
        inProgress: inProgressTrips,
        cancellationFees: typedCancellationFees,
        totals,
        byDriver: Array.from(byDriverMap.values()).sort(
          (a, b) => b.completed_revenue - a.completed_revenue
        ),
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
