import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
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
        driver_id,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      trips: data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load trips." },
      { status: 500 }
    );
  }
}