import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type CompletedTripRow = {
  id: string;
  fare_amount: number | string | null;
  commission_amount: number | string | null;
  driver_net_earnings: number | string | null;
  payment_method: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  created_at: string | null;
  status: string | null;
};

type SettlementRow = {
  id: string;
  amount_paid: number | string | null;
  payment_method: string | null;
  reference: string | null;
  note: string | null;
  created_at: string | null;
};

type TripEventRow = {
  trip_id: string;
  event_type: string | null;
  created_at: string;
};

type CancellationFeeRow = {
  id: string;
  trip_id: string;
  fee_type: string;
  fee_amount: number | string | null;
  driver_amount: number | string | null;
  moovu_amount: number | string | null;
  reason: string | null;
  created_at: string | null;
};

type CompletedTripWithTimestamp = CompletedTripRow & {
  completed_at: string | null;
};

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error.";
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

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

    const { data: account, error: accountError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (accountError || !account?.driver_id) {
      return NextResponse.json(
        { ok: false, error: "Driver account is not linked." },
        { status: 404 }
      );
    }

    const driverId = account.driver_id;

    const [
      { data: wallet, error: walletError },
      { data: driver, error: driverError },
      { data: settlements, error: settlementsError },
      { data: subscriptionPayments, error: subscriptionPaymentsError },
      { data: paymentRequests, error: paymentRequestsError },
      { data: completedTrips, error: tripError },
    ] = await Promise.all([
      supabaseAdmin
        .from("driver_wallets")
        .select("*")
        .eq("driver_id", driverId)
        .maybeSingle(),
      supabaseAdmin
        .from("drivers")
        .select(`
          id,
          first_name,
          last_name,
          phone,
          subscription_status,
          subscription_plan,
          subscription_expires_at,
          subscription_amount_due,
          subscription_last_paid_at,
          subscription_last_payment_amount
        `)
        .eq("id", driverId)
        .maybeSingle(),
      supabaseAdmin
        .from("driver_settlements")
        .select("id,amount_paid,payment_method,reference,note,created_at")
        .eq("driver_id", driverId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("driver_subscription_payments")
        .select("id,amount_paid,payment_method,reference,note,created_at")
        .eq("driver_id", driverId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("driver_payment_requests")
        .select(`
          id,
          payment_type,
          subscription_plan,
          amount_expected,
          amount_submitted,
          payment_reference,
          note,
          pop_file_url,
          status,
          review_note,
          submitted_at,
          reviewed_at
        `)
        .eq("driver_id", driverId)
        .order("submitted_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("trips")
        .select(`
          id,
          fare_amount,
          commission_amount,
          driver_net_earnings,
          payment_method,
          pickup_address,
          dropoff_address,
          created_at,
          status
        `)
        .eq("driver_id", driverId)
        .eq("status", "completed")
        .limit(100),
    ]);

    if (walletError) {
      return NextResponse.json({ ok: false, error: walletError.message }, { status: 500 });
    }
    if (driverError) {
      return NextResponse.json({ ok: false, error: driverError.message }, { status: 500 });
    }
    if (settlementsError) {
      return NextResponse.json({ ok: false, error: settlementsError.message }, { status: 500 });
    }
    if (subscriptionPaymentsError) {
      return NextResponse.json({ ok: false, error: subscriptionPaymentsError.message }, { status: 500 });
    }
    if (paymentRequestsError) {
      return NextResponse.json({ ok: false, error: paymentRequestsError.message }, { status: 500 });
    }
    if (tripError) {
      return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
    }

    const typedCompletedTrips = (completedTrips ?? []) as CompletedTripRow[];
    const typedSettlements = (settlements ?? []) as SettlementRow[];

    const totalCommission = typedCompletedTrips.reduce(
      (sum, trip) => sum + num(trip.commission_amount),
      0
    );

    const totalDriverNet = typedCompletedTrips.reduce((sum, trip) => {
      if (trip.driver_net_earnings != null) {
        return sum + num(trip.driver_net_earnings);
      }
      return sum + (num(trip.fare_amount) - num(trip.commission_amount));
    }, 0);

    const totalTripsCompleted = typedCompletedTrips.length;

    const totalSettled = typedSettlements.reduce(
      (sum, row) => sum + num(row.amount_paid),
      0
    );

    const balanceDue = Math.max(0, totalCommission - totalSettled);

    let normalizedWallet = wallet;

    if (wallet?.id) {
      const { data: updatedWallet, error: walletUpdateError } = await supabaseAdmin
        .from("driver_wallets")
        .update({
          balance_due: balanceDue,
          total_commission: totalCommission,
          total_driver_net: totalDriverNet,
          total_trips_completed: totalTripsCompleted,
          account_status: balanceDue > 0 ? "due" : "settled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", wallet.id)
        .select("*")
        .single();

      if (walletUpdateError) {
        return NextResponse.json({ ok: false, error: walletUpdateError.message }, { status: 500 });
      }

      normalizedWallet = updatedWallet;
    } else {
      const { data: createdWallet, error: createWalletError } = await supabaseAdmin
        .from("driver_wallets")
        .insert({
          driver_id: driverId,
          balance_due: balanceDue,
          total_commission: totalCommission,
          total_driver_net: totalDriverNet,
          total_trips_completed: totalTripsCompleted,
          account_status: balanceDue > 0 ? "due" : "settled",
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (createWalletError) {
        return NextResponse.json({ ok: false, error: createWalletError.message }, { status: 500 });
      }

      normalizedWallet = createdWallet;
    }

    const tripIds = typedCompletedTrips.map((trip) => trip.id);
    const completedAtMap = new Map<string, string>();

    if (tripIds.length > 0) {
      const { data: events } = await supabaseAdmin
        .from("trip_events")
        .select("trip_id,event_type,created_at")
        .in("trip_id", tripIds)
        .eq("event_type", "trip_completed")
        .order("created_at", { ascending: false });

      for (const row of ((events ?? []) as TripEventRow[])) {
        if (!completedAtMap.has(row.trip_id)) {
          completedAtMap.set(row.trip_id, row.created_at);
        }
      }
    }

    const normalizedTrips = typedCompletedTrips
      .map<CompletedTripWithTimestamp>((trip) => ({
        ...trip,
        completed_at: completedAtMap.get(trip.id) ?? trip.created_at,
      }))
      .sort(
        (a, b) =>
          new Date(b.completed_at ?? 0).getTime() - new Date(a.completed_at ?? 0).getTime()
      )
      .slice(0, 50);

    const { data: cancellationFees } = await supabaseAdmin
      .from("trip_cancellation_fees")
      .select("id,trip_id,fee_type,fee_amount,driver_amount,moovu_amount,reason,created_at")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(50);

    const typedCancellationFees = (cancellationFees ?? []) as CancellationFeeRow[];
    const cancellationDriverEarnings = typedCancellationFees.reduce(
      (sum, row) => sum + num(row.driver_amount),
      0
    );
    const lateCancellationDriverEarnings = typedCancellationFees
      .filter((row) => row.fee_type === "late_cancel")
      .reduce((sum, row) => sum + num(row.driver_amount), 0);
    const noShowDriverEarnings = typedCancellationFees
      .filter((row) => row.fee_type === "no_show")
      .reduce((sum, row) => sum + num(row.driver_amount), 0);

    return NextResponse.json({
      ok: true,
      earnings: {
        wallet: normalizedWallet ?? null,
        driver: driver ?? null,
        settlements: settlements ?? [],
        subscription_payments: subscriptionPayments ?? [],
        payment_requests: paymentRequests ?? [],
        recent_completed_trips: normalizedTrips,
        cancellation_fees: typedCancellationFees,
        cancellation_driver_earnings: cancellationDriverEarnings,
        late_cancellation_driver_earnings: lateCancellationDriverEarnings,
        no_show_driver_earnings: noShowDriverEarnings,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
