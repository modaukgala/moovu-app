import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function normalizePhone(value: string) {
  return value.replace(/\s+/g, "").trim();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const phone = normalizePhone(String(searchParams.get("phone") ?? ""));

    if (!phone) {
      return NextResponse.json(
        { ok: false, error: "Phone number is required." },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: trips, error } = await supabase
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
        driver_id
      `)
      .eq("rider_phone", phone)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      trips: trips ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}
