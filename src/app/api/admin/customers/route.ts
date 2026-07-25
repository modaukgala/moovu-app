import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

type CustomerRow = {
  id: string;
  auth_user_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  normalized_phone?: string | null;
  email?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CustomerTripRow = {
  id: string;
  customer_id: string | null;
  status: string | null;
  fare_amount: number | null;
  final_fare?: number | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  payment_method: string | null;
  created_at: string | null;
  completed_at?: string | null;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function tripValue(trip: CustomerTripRow) {
  return Number(trip.final_fare ?? trip.fare_amount ?? 0);
}

function activityTime(trip: CustomerTripRow) {
  return trip.completed_at || trip.created_at || "";
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
    }

    const customerId = new URL(req.url).searchParams.get("customerId")?.trim();
    let customerQuery = auth.supabaseAdmin
      .from("customers")
      .select("*")
      .limit(customerId ? 1 : 500);

    if (customerId) {
      customerQuery = customerQuery.eq("id", customerId);
    }

    const { data: customerData, error: customerError } = await customerQuery;
    if (customerError) {
      console.error("[admin-customers] customer lookup failed", customerError);
      return NextResponse.json(
        { ok: false, error: "Could not load customers. Please try again." },
        { status: 500 },
      );
    }

    const customers = (customerData ?? []) as CustomerRow[];
    const customerIds = customers.map((customer) => customer.id);
    let trips: CustomerTripRow[] = [];

    if (customerIds.length > 0) {
      const tripQuery = await auth.supabaseAdmin
        .from("trips")
        .select(
          "id,customer_id,status,fare_amount,final_fare,pickup_address,dropoff_address,payment_method,created_at,completed_at",
        )
        .in("customer_id", customerIds)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (tripQuery.error) {
        const legacyTripQuery = await auth.supabaseAdmin
          .from("trips")
          .select(
            "id,customer_id,status,fare_amount,pickup_address,dropoff_address,payment_method,created_at",
          )
          .in("customer_id", customerIds)
          .order("created_at", { ascending: false })
          .limit(5000);

        if (legacyTripQuery.error) {
          console.error("[admin-customers] trip summary lookup failed", legacyTripQuery.error);
          return NextResponse.json(
            { ok: false, error: "Could not load customer trip summaries. Please try again." },
            { status: 500 },
          );
        }

        trips = (legacyTripQuery.data ?? []) as CustomerTripRow[];
      } else {
        trips = (tripQuery.data ?? []) as CustomerTripRow[];
      }
    }

    const tripsByCustomer = new Map<string, CustomerTripRow[]>();
    for (const trip of trips) {
      if (!trip.customer_id) continue;
      const rows = tripsByCustomer.get(trip.customer_id) ?? [];
      rows.push(trip);
      tripsByCustomer.set(trip.customer_id, rows);
    }

    const enriched = customers.map((customer) => {
      const customerTrips = tripsByCustomer.get(customer.id) ?? [];
      const completedTrips = customerTrips.filter((trip) => trip.status === "completed");
      const cancelledTrips = customerTrips.filter((trip) =>
        ["cancelled", "canceled", "no_show"].includes(String(trip.status ?? "").toLowerCase()),
      );
      const lastTrip = [...customerTrips].sort((a, b) =>
        activityTime(b).localeCompare(activityTime(a)),
      )[0] ?? null;

      return {
        id: customer.id,
        first_name: customer.first_name ?? null,
        last_name: customer.last_name ?? null,
        phone: customer.phone ?? customer.normalized_phone ?? null,
        email: customer.email ?? null,
        status: customer.status ?? "active",
        created_at: customer.created_at ?? null,
        updated_at: customer.updated_at ?? null,
        total_trips: customerTrips.length,
        completed_trips: completedTrips.length,
        cancelled_trips: cancelledTrips.length,
        total_spend: completedTrips.reduce((total, trip) => total + tripValue(trip), 0),
        last_trip_status: lastTrip?.status ?? null,
        last_activity:
          (lastTrip ? activityTime(lastTrip) : null) ||
          customer.updated_at ||
          customer.created_at ||
          null,
        trips: customerId ? customerTrips : undefined,
      };
    });

    return NextResponse.json({
      ok: true,
      customers: enriched,
      customer: customerId ? enriched[0] ?? null : undefined,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "Could not load customers.") },
      { status: 500 },
    );
  }
}
