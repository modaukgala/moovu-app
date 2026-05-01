import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

type DispatchTripRow = {
  id: string;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  status: string;
  cancel_reason: string | null;
  created_at: string;
  offer_status: string | null;
  offer_expires_at: string | null;
  offer_attempted_driver_ids: string[] | null;
};

type DispatchDriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  online: boolean | null;
  busy: boolean | null;
  subscription_status: string | null;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;

    const { data: trips, error: tErr } = await supabaseAdmin
      .from("trips")
      .select(`
        id,
        driver_id,
        pickup_address,
        dropoff_address,
        fare_amount,
        payment_method,
        status,
        cancel_reason,
        created_at,
        offer_status,
        offer_expires_at,
        offer_attempted_driver_ids
      `)
      .order("created_at", { ascending: false })
      .limit(300);

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }

    const driverIds = Array.from(
      new Set(
        ((trips ?? []) as DispatchTripRow[])
          .map((trip) => trip.driver_id)
          .filter((driverId): driverId is string => Boolean(driverId))
      )
    );

    let driversById: Record<string, DispatchDriverRow> = {};

    if (driverIds.length > 0) {
      const { data: drivers, error: dErr } = await supabaseAdmin
        .from("drivers")
        .select("id, first_name, last_name, phone, online, busy, subscription_status")
        .in("id", driverIds);

      if (dErr) {
        return NextResponse.json({ ok: false, error: dErr.message }, { status: 500 });
      }

      driversById = Object.fromEntries(
        ((drivers ?? []) as DispatchDriverRow[]).map((driver) => [driver.id, driver])
      );
    }

    const rows = ((trips ?? []) as DispatchTripRow[]).map((trip) => {
      const driver = trip.driver_id ? driversById[trip.driver_id] : null;
      return {
        ...trip,
        driver: driver
          ? {
              id: driver.id,
              name: `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || "Unnamed",
              phone: driver.phone ?? null,
              online: driver.online ?? null,
              busy: driver.busy ?? null,
              subscription_status: driver.subscription_status ?? null,
            }
          : null,
        attempted_count: Array.isArray(trip.offer_attempted_driver_ids)
          ? trip.offer_attempted_driver_ids.length
          : 0,
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
