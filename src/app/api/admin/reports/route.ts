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

    const [{ data: completed, error: completedErr }, { data: inProgress, error: inProgressErr }, { data: drivers, error: driversErr }] =
      await Promise.all([
        completedQuery,
        inProgressQuery,
        supabaseAdmin.from("drivers").select("id,first_name,last_name,phone"),
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

    const driverNameById = new Map<string, string>();
    for (const d of drivers ?? []) {
      const fullName = `${(d as any).first_name ?? ""} ${(d as any).last_name ?? ""}`.trim();
      driverNameById.set((d as any).id, fullName || (d as any).phone || (d as any).id);
    }

    const completedTrips = ((completed ?? []) as TripRow[]).map((trip) => ({
      ...trip,
      driver_name: trip.driver_id ? driverNameById.get(trip.driver_id) ?? trip.driver_id : null,
    }));

    const inProgressTrips = ((inProgress ?? []) as TripRow[]).map((trip) => ({
      ...trip,
      driver_name: trip.driver_id ? driverNameById.get(trip.driver_id) ?? trip.driver_id : null,
    }));

    const totals = {
      completedTrips: completedTrips.length,
      completedRevenue: completedTrips.reduce((s, t) => s + num(t.fare_amount), 0),
      completedCommission: completedTrips.reduce((s, t) => s + num(t.commission_amount), 0),
      completedDriverNet: completedTrips.reduce((s, t) => s + num(t.driver_net_earnings), 0),
      inProgressTrips: inProgressTrips.length,
      inProgressValue: inProgressTrips.reduce((s, t) => s + num(t.fare_amount), 0),
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
        };

      row.completed_trips += 1;
      row.completed_revenue += num(trip.fare_amount);
      row.completed_commission += num(trip.commission_amount);
      row.completed_driver_net += num(trip.driver_net_earnings);

      byDriverMap.set(trip.driver_id, row);
    }

    return NextResponse.json({
      ok: true,
      report: {
        completed: completedTrips,
        inProgress: inProgressTrips,
        totals,
        byDriver: Array.from(byDriverMap.values()).sort(
          (a, b) => b.completed_revenue - a.completed_revenue
        ),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}