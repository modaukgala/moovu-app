import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  try {
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
      new Set((trips ?? []).map((t: any) => t.driver_id).filter(Boolean))
    );

    let driversById: Record<string, any> = {};

    if (driverIds.length > 0) {
      const { data: drivers, error: dErr } = await supabaseAdmin
        .from("drivers")
        .select("id, first_name, last_name, phone, online, busy, subscription_status")
        .in("id", driverIds);

      if (dErr) {
        return NextResponse.json({ ok: false, error: dErr.message }, { status: 500 });
      }

      driversById = Object.fromEntries((drivers ?? []).map((d: any) => [d.id, d]));
    }

    const rows = (trips ?? []).map((t: any) => {
      const d = t.driver_id ? driversById[t.driver_id] : null;
      return {
        ...t,
        driver: d
          ? {
              id: d.id,
              name: `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed",
              phone: d.phone ?? null,
              online: d.online ?? null,
              busy: d.busy ?? null,
              subscription_status: d.subscription_status ?? null,
            }
          : null,
        attempted_count: Array.isArray(t.offer_attempted_driver_ids)
          ? t.offer_attempted_driver_ids.length
          : 0,
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}