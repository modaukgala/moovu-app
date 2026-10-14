import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { adminDriverName } from "@/lib/admin/identity";

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

type TripEventRow = {
  trip_id: string;
  event_type: string;
  created_at: string;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

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
    const params = new URL(req.url).searchParams;
    const from = params.get("from");
    const to = params.get("to");
    const driverId = params.get("driverId");
    const fromMs = from ? Date.parse(from) : null;
    const toMs = to ? Date.parse(to) : null;
    if ((from && !Number.isFinite(fromMs)) || (to && !Number.isFinite(toMs))
      || (fromMs != null && toMs != null && toMs <= fromMs)
      || (driverId && !/^[0-9a-f-]{36}$/i.test(driverId))) {
      return NextResponse.json({ ok: false, error: "Invalid earnings filters." }, { status: 400 });
    }

    const completedTrips: TripRow[] = [];
    for (let offset = 0; offset <= 10000; offset += 1000) {
      let query = supabaseAdmin.from("trips").select(`
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
        `).eq("status", "completed");
      if (driverId) query = query.eq("driver_id", driverId);
      const { data, error } = await query.order("created_at", { ascending: false }).order("id").range(offset, offset + 999);
      if (error) return NextResponse.json({ ok: false, error: "Completed trips are unavailable." }, { status: 503 });
      if (offset === 10000 && data?.length) {
        return NextResponse.json({ ok: false, error: "Earnings history exceeds the safe reporting limit. Narrow the Driver filter." }, { status: 503 });
      }
      completedTrips.push(...((data ?? []) as TripRow[]));
      if (!data || data.length < 1000) break;
    }
    const driverIds = [...new Set(completedTrips.map((trip) => trip.driver_id).filter((id): id is string => !!id))];
    const drivers: DriverRow[] = [];
    for (let offset = 0; offset < driverIds.length; offset += 100) {
      const { data, error } = await supabaseAdmin.from("drivers")
        .select("id,first_name,last_name,phone").in("id", driverIds.slice(offset, offset + 100));
      if (error) return NextResponse.json({ ok: false, error: "Driver names are unavailable." }, { status: 503 });
      drivers.push(...((data ?? []) as DriverRow[]));
    }

    const driverNameById = new Map<string, string>();
    for (const driver of drivers) {
      driverNameById.set(driver.id, adminDriverName(driver));
    }

    const tripIds = completedTrips.map((t) => t.id);

    const completedAtMap = new Map<string, string>();

    if (tripIds.length > 0) {
      for (let offset = 0; offset < tripIds.length; offset += 100) {
        for (let eventOffset = 0; ; eventOffset += 1000) {
          const { data: events, error: eventsError } = await supabaseAdmin
            .from("trip_events").select("trip_id,event_type,created_at")
            .in("trip_id", tripIds.slice(offset, offset + 100))
            .eq("event_type", "trip_completed")
            .order("created_at", { ascending: false }).order("trip_id")
            .range(eventOffset, eventOffset + 999);
          if (eventsError) return NextResponse.json({ ok: false, error: "Trip completion history is unavailable." }, { status: 503 });
          for (const row of (events ?? []) as TripEventRow[]) {
            if (!completedAtMap.has(row.trip_id)) completedAtMap.set(row.trip_id, row.created_at);
          }
          if (!events || events.length < 1000) break;
        }
      }
    }

    const normalizedTrips = completedTrips.map((trip) => ({
      ...trip,
      completed_at: completedAtMap.get(trip.id) ?? trip.created_at,
      driver_name: trip.driver_id ? driverNameById.get(trip.driver_id) ?? "Driver profile unavailable" : null,
    })).filter((trip) => {
      const completedMs = trip.completed_at ? Date.parse(trip.completed_at) : Number.NaN;
      return (fromMs == null || completedMs >= fromMs) && (toMs == null || completedMs < toMs);
    });

    const todayStart = startOfToday().getTime();
    const weekStart = startOfWeek().getTime();
    const monthStart = startOfMonth().getTime();

    let todayTotal = 0;
    let weekTotal = 0;
    let monthTotal = 0;

    let todayCommission = 0;
    let weekCommission = 0;
    let monthCommission = 0;

    for (const trip of normalizedTrips) {
      const fare = moneyNumber(trip.fare_amount);
      const commission = moneyNumber(trip.commission_amount);
      const completedAt = trip.completed_at ? new Date(trip.completed_at).getTime() : 0;

      if (completedAt >= todayStart) {
        todayTotal += fare;
        todayCommission += commission;
      }
      if (completedAt >= weekStart) {
        weekTotal += fare;
        weekCommission += commission;
      }
      if (completedAt >= monthStart) {
        monthTotal += fare;
        monthCommission += commission;
      }
    }

    const totalRevenue = normalizedTrips.reduce(
      (sum, trip) => sum + moneyNumber(trip.fare_amount),
      0
    );

    const totalCommission = normalizedTrips.reduce(
      (sum, trip) => sum + moneyNumber(trip.commission_amount),
      0
    );

    const driverPayoutEstimate = normalizedTrips.reduce(
      (sum, trip) =>
        sum +
        (trip.driver_net_earnings != null
          ? moneyNumber(trip.driver_net_earnings)
          : moneyNumber(trip.fare_amount) - moneyNumber(trip.commission_amount)),
      0
    );

    const byPaymentMethod = normalizedTrips.reduce<
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
        commission_rate: null,
        commission_rate_label: "Stored commission for each completed trip; historical rates may differ.",
        total_completed_trips: normalizedTrips.length,
        by_payment_method: byPaymentMethod,
        recent_completed_trips: normalizedTrips.slice(0, 15),
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error.") },
      { status: 500 }
    );
  }
}
