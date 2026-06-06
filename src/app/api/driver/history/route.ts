import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error.";
}

function isMissingHistoryColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42703" && (
    message.includes("commission_amount") ||
    message.includes("driver_net_earnings") ||
    message.includes("completed_at") ||
    message.includes("ride_option")
  );
}

const HISTORY_SELECT = `
  id,
  rider_name,
  rider_phone,
  pickup_address,
  dropoff_address,
  fare_amount,
  commission_amount,
  driver_net_earnings,
  payment_method,
  status,
  created_at,
  completed_at,
  driver_id,
  ride_option
`;

const LEGACY_HISTORY_SELECT = `
  id,
  rider_name,
  rider_phone,
  pickup_address,
  dropoff_address,
  fare_amount,
  payment_method,
  status,
  created_at,
  driver_id
`;

type DriverHistoryRow = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  commission_amount?: number | null;
  driver_net_earnings?: number | null;
  payment_method: string | null;
  status: string | null;
  created_at: string | null;
  completed_at?: string | null;
  driver_id: string | null;
  ride_option?: string | null;
};

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

    const tripsQuery = await supabaseAdmin
      .from("trips")
      .select(HISTORY_SELECT)
      .eq("driver_id", mapping.driver_id)
      .order("created_at", { ascending: false });

    let trips = tripsQuery.data as DriverHistoryRow[] | null;
    let tripsError = tripsQuery.error;

    if (isMissingHistoryColumn(tripsQuery.error)) {
      const legacyTripsQuery = await supabaseAdmin
        .from("trips")
        .select(LEGACY_HISTORY_SELECT)
        .eq("driver_id", mapping.driver_id)
        .order("created_at", { ascending: false });
      trips = legacyTripsQuery.data as DriverHistoryRow[] | null;
      tripsError = legacyTripsQuery.error;
    }

    if (tripsError) {
      return NextResponse.json(
        { ok: false, error: tripsError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      trips: trips ?? [],
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
