import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;

    const { data: drivers, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select(`
        id,
        first_name,
        last_name,
        phone,
        online,
        busy,
        subscription_status,
        driver_wallets (
          id,
          balance_due,
          total_commission,
          total_driver_net,
          total_trips_completed,
          last_payment_at,
          last_payment_amount,
          account_status
        )
      `)
      .order("first_name");

    if (driverError) {
      return NextResponse.json({ ok: false, error: driverError.message }, { status: 500 });
    }

    const { data: settlements, error: settlementError } = await supabaseAdmin
      .from("driver_settlements")
      .select(`
        id,
        driver_id,
        wallet_id,
        amount_paid,
        payment_method,
        reference,
        note,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (settlementError) {
      return NextResponse.json({ ok: false, error: settlementError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      drivers: drivers ?? [],
      settlements: settlements ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}