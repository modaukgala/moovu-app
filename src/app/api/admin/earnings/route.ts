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

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfWeek() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const d = new Date(now);
  d.setDate(now.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function moneyNumber(value: unknown) {
  const n = Number(value ?? 0);
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

    const { data: trips, error: tripsError } = await supabaseAdmin
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

    if (tripsError) {
      return NextResponse.json(
        { ok: false, error: tripsError.message },
        { status: 500 }
      );
    }

    const completedTrips = (trips ?? []) as TripRow[];

    const todayStart = startOfToday().getTime();
    const weekStart = startOfWeek().getTime();
    const monthStart = startOfMonth().getTime();

    let todayTotal = 0;
    let weekTotal = 0;
    let monthTotal = 0;

    let todayCommission = 0;
    let weekCommission = 0;
    let monthCommission = 0;

    for (const trip of completedTrips) {
      const fare = moneyNumber(trip.fare_amount);
      const commission = moneyNumber(trip.commission_amount);
      const createdAt = trip.created_at ? new Date(trip.created_at).getTime() : 0;

      if (createdAt >= todayStart) {
        todayTotal += fare;
        todayCommission += commission;
      }
      if (createdAt >= weekStart) {
        weekTotal += fare;
        weekCommission += commission;
      }
      if (createdAt >= monthStart) {
        monthTotal += fare;
        monthCommission += commission;
      }
    }

    const totalRevenue = completedTrips.reduce(
      (sum, trip) => sum + moneyNumber(trip.fare_amount),
      0
    );

    const totalCommission = completedTrips.reduce(
      (sum, trip) => sum + moneyNumber(trip.commission_amount),
      0
    );

    const driverPayoutEstimate = completedTrips.reduce(
      (sum, trip) =>
        sum +
        (trip.driver_net_earnings != null
          ? moneyNumber(trip.driver_net_earnings)
          : moneyNumber(trip.fare_amount) - moneyNumber(trip.commission_amount)),
      0
    );

    const byPaymentMethod = completedTrips.reduce<
      Record<string, { revenue: number; commission: number; count: number }>
    >((acc, trip) => {
      const key = String(trip.payment_method ?? "unknown").toLowerCase();
      if (!acc[key]) {
        acc[key] = { revenue: 0, commission: 0, count: 0 };
      }
      acc[key].revenue += moneyNumber(trip.fare_amount);
      acc[key].commission += moneyNumber(trip.commission_amount);
      acc[key].count += 1;
      return acc;
    }, {});

    return NextResponse.json({
      ok: true,
      earnings: {
        today_total: todayTotal,
        week_total: weekTotal,
        month_total: monthTotal,
        today_commission: todayCommission,
        week_commission: weekCommission,
        month_commission: monthCommission,
        total_revenue: totalRevenue,
        total_commission: totalCommission,
        estimated_driver_payout: driverPayoutEstimate,
        commission_rate: 0.05,
        total_completed_trips: completedTrips.length,
        by_payment_method: byPaymentMethod,
        recent_completed_trips: completedTrips.slice(0, 15),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}