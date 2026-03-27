import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { searchParams } = new URL(req.url);

    const q = String(searchParams.get("q") ?? "").trim();
    const status = String(searchParams.get("status") ?? "").trim();
    const dateFrom = String(searchParams.get("dateFrom") ?? "").trim();
    const dateTo = String(searchParams.get("dateTo") ?? "").trim();

    const { supabaseAdmin } = auth;

    let query = supabaseAdmin
      .from("trips")
      .select(`
        id,
        rider_name,
        rider_phone,
        pickup_address,
        dropoff_address,
        fare_amount,
        payment_method,
        status,
        created_at,
        driver_id,
        commission_amount,
        driver_net_earnings
      `)
      .order("created_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (dateFrom) {
      query = query.gte("created_at", `${dateFrom}T00:00:00`);
    }

    if (dateTo) {
      query = query.lte("created_at", `${dateTo}T23:59:59`);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    let trips = data ?? [];

    if (q) {
      const term = q.toLowerCase();
      trips = trips.filter((trip: any) => {
        return (
          String(trip.id ?? "").toLowerCase().includes(term) ||
          String(trip.rider_name ?? "").toLowerCase().includes(term) ||
          String(trip.rider_phone ?? "").toLowerCase().includes(term) ||
          String(trip.pickup_address ?? "").toLowerCase().includes(term) ||
          String(trip.dropoff_address ?? "").toLowerCase().includes(term) ||
          String(trip.driver_id ?? "").toLowerCase().includes(term)
        );
      });
    }

    return NextResponse.json({
      ok: true,
      trips,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}