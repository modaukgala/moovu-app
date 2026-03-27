import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type TripRow = {
  id: string;
  fare_amount: number | null;
  payment_method: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  status: string | null;
  created_at: string | null;
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
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing access token." },
        { status: 401 }
      );
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mappingError || !mapping?.driver_id) {
      return NextResponse.json(
        { ok: false, error: "Driver account not linked." },
        { status: 400 }
      );
    }

    const driverId = mapping.driver_id;

    const { data: trips, error: tripsError } = await supabaseAdmin
      .from("trips")
      .select(`
        id,
        fare_amount,
        payment_method,
        pickup_address,
        dropoff_address,
        status,
        created_at
      `)
      .eq("driver_id", driverId)
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

    for (const trip of completedTrips) {
      const fare = moneyNumber(trip.fare_amount);
      const createdAt = trip.created_at ? new Date(trip.created_at).getTime() : 0;

      if (createdAt >= todayStart) todayTotal += fare;
      if (createdAt >= weekStart) weekTotal += fare;
      if (createdAt >= monthStart) monthTotal += fare;
    }

    return NextResponse.json({
      ok: true,
      earnings: {
        today_total: todayTotal,
        week_total: weekTotal,
        month_total: monthTotal,
        total_completed_trips: completedTrips.length,
        recent_completed_trips: completedTrips.slice(0, 10),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}