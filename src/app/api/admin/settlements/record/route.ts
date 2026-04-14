import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin, user } = auth;
    const body = await req.json();

    const driverId = String(body?.driverId ?? "").trim();
    const amountPaid = Number(body?.amountPaid ?? 0);
    const paymentMethod = String(body?.paymentMethod ?? "cash").trim();
    const reference = String(body?.reference ?? "").trim();
    const note = String(body?.note ?? "").trim();

    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Driver ID is required." }, { status: 400 });
    }

    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      return NextResponse.json({ ok: false, error: "Amount paid must be greater than zero." }, { status: 400 });
    }

    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("driver_wallets")
      .select("*")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (walletError) {
      return NextResponse.json({ ok: false, error: walletError.message }, { status: 500 });
    }

    if (!wallet) {
      return NextResponse.json({ ok: false, error: "Driver wallet not found." }, { status: 404 });
    }

    const newBalance = Math.max(0, Number(wallet.balance_due || 0) - amountPaid);

    const { error: insertError } = await supabaseAdmin
      .from("driver_settlements")
      .insert({
        driver_id: driverId,
        wallet_id: wallet.id,
        amount_paid: amountPaid,
        payment_method: paymentMethod,
        reference: reference || null,
        note: note || null,
        received_by: user.id,
      });

    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    }

    const { error: walletUpdateError } = await supabaseAdmin
      .from("driver_wallets")
      .update({
        balance_due: newBalance,
        last_payment_at: new Date().toISOString(),
        last_payment_amount: amountPaid,
        account_status: newBalance > 0 ? "active" : "settled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", wallet.id);

    if (walletUpdateError) {
      return NextResponse.json({ ok: false, error: walletUpdateError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: "Driver settlement recorded successfully.",
      balanceDue: newBalance,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}