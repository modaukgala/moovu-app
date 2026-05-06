import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type CommissionTripRow = {
  commission_amount: number | null;
};

type ExistingSettlementRow = {
  amount_paid: number | null;
};

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

    const [{ data: driver, error: driverError }, { data: trips, error: tripError }, { data: existingSettlements, error: settlementsError }] =
      await Promise.all([
        supabaseAdmin.from("drivers").select("id").eq("id", driverId).maybeSingle(),
        supabaseAdmin
          .from("trips")
          .select("id,commission_amount")
          .eq("driver_id", driverId)
          .eq("status", "completed"),
        supabaseAdmin
          .from("driver_settlements")
          .select("id,amount_paid")
          .eq("driver_id", driverId),
      ]);

    if (driverError) {
      return NextResponse.json({ ok: false, error: driverError.message }, { status: 500 });
    }

    if (!driver) {
      return NextResponse.json({ ok: false, error: "Driver not found." }, { status: 404 });
    }

    if (tripError) {
      return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
    }

    if (settlementsError) {
      return NextResponse.json({ ok: false, error: settlementsError.message }, { status: 500 });
    }

    const totalCommission = ((trips ?? []) as CommissionTripRow[]).reduce(
      (sum, row) => sum + num(row.commission_amount),
      0,
    );
    const totalSettledBefore = ((existingSettlements ?? []) as ExistingSettlementRow[]).reduce(
      (sum, row) => sum + num(row.amount_paid),
      0,
    );
    const currentDue = Math.max(0, totalCommission - totalSettledBefore);

    if (currentDue <= 0) {
      return NextResponse.json(
        { ok: false, error: "This driver does not currently owe MOOVU any outstanding balance." },
        { status: 400 }
      );
    }

    if (amountPaid > currentDue + 0.009) {
      return NextResponse.json(
        { ok: false, error: `Amount exceeds current balance due of R${currentDue.toFixed(2)}.` },
        { status: 400 }
      );
    }

    const { data: existingWallet, error: walletError } = await supabaseAdmin
      .from("driver_wallets")
      .select("*")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (walletError) {
      return NextResponse.json({ ok: false, error: walletError.message }, { status: 500 });
    }

    let wallet = existingWallet;

    if (!wallet) {
      const { data: newWallet, error: createWalletError } = await supabaseAdmin
        .from("driver_wallets")
        .insert({
          driver_id: driverId,
          balance_due: currentDue,
          total_commission: totalCommission,
          total_driver_net: 0,
          total_trips_completed: (trips ?? []).length,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (createWalletError || !newWallet) {
        return NextResponse.json(
          { ok: false, error: createWalletError?.message || "Failed to create driver wallet." },
          { status: 500 }
        );
      }

      wallet = newWallet;
    }

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

    const newTotalSettled = totalSettledBefore + amountPaid;
    const newBalance = Math.max(0, totalCommission - newTotalSettled);

    const { error: walletUpdateError } = await supabaseAdmin
      .from("driver_wallets")
      .update({
        balance_due: newBalance,
        total_commission: totalCommission,
        total_trips_completed: (trips ?? []).length,
        last_payment_at: new Date().toISOString(),
        last_payment_amount: amountPaid,
        account_status: newBalance > 0 ? "due" : "settled",
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
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
