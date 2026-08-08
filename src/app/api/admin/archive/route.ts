import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

type ArchivedTripRow = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  status: string | null;
  created_at: string | null;
  driver_id: string | null;
  commission_amount: number | null;
  driver_net_earnings: number | null;
};

type ArchivedTripWithDriver = ArchivedTripRow & {
  driver_name: string | null;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
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

    const rawTrips = (data ?? []) as ArchivedTripRow[];
    const driverIds = Array.from(
      new Set(rawTrips.map((trip) => String(trip.driver_id ?? "").trim()).filter(Boolean)),
    );
    const driverNameById = new Map<string, string>();

    if (driverIds.length > 0) {
      const { data: driverRows, error: driverError } = await supabaseAdmin
        .from("drivers")
        .select("id,first_name,last_name")
        .in("id", driverIds);

      if (driverError) {
        console.error("[admin-archive] failed to resolve driver names", driverError);
      } else {
        for (const driver of driverRows ?? []) {
          const name = `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim();
          driverNameById.set(String(driver.id), name || "Driver profile unavailable");
        }
      }
    }

    let trips: ArchivedTripWithDriver[] = rawTrips.map((trip) => ({
      ...trip,
      driver_name: trip.driver_id
        ? driverNameById.get(trip.driver_id) ?? "Driver profile unavailable"
        : null,
    }));

    if (q) {
      const term = q.toLowerCase();
      trips = trips.filter((trip) => {
        return (
          String(trip.id ?? "").toLowerCase().includes(term) ||
          String(trip.rider_name ?? "").toLowerCase().includes(term) ||
          String(trip.rider_phone ?? "").toLowerCase().includes(term) ||
          String(trip.pickup_address ?? "").toLowerCase().includes(term) ||
          String(trip.dropoff_address ?? "").toLowerCase().includes(term) ||
          String(trip.driver_name ?? "").toLowerCase().includes(term)
        );
      });
    }

    return NextResponse.json({
      ok: true,
      trips,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error.") },
      { status: 500 }
    );
  }
}
