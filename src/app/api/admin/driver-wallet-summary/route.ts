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

    const { supabaseAdmin } = auth;
    const url = new URL(req.url);
    const driverId = String(url.searchParams.get("driverId") ?? "").trim();

    if (!driverId) {
      return NextResponse.json(
        { ok: false, error: "Missing driverId" },
        { status: 400 }
      );
    }

    const { data: wallet, error: walletErr } = await supabaseAdmin
      .from("driver_wallets")
      .select(`
        driver_id,
        balance_due,
        total_commission,
        total_driver_net,
        total_trips_completed,
        updated_at
      `)
      .eq("driver_id", driverId)
      .maybeSingle();

    if (walletErr) {
      return NextResponse.json(
        { ok: false, error: walletErr.message },
        { status: 500 }
      );
    }

    const { data: txns, error: txErr } = await supabaseAdmin
      .from("driver_wallet_transactions")
      .select(`
        id,
        trip_id,
        tx_type,
        amount,
        created_at
      `)
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (txErr) {
      return NextResponse.json(
        { ok: false, error: txErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      wallet: wallet ?? {
        driver_id: driverId,
        balance_due: 0,
        total_commission: 0,
        total_driver_net: 0,
        total_trips_completed: 0,
        updated_at: null,
      },
      transactions: txns ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}