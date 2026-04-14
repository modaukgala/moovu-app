import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

    const [{ data: wallet, error: walletError }, { data: driver, error: driverError }, { data: transactions, error: txError }, { data: settlements, error: settlementsError }, { data: subscriptionPayments, error: subscriptionPaymentsError }, { data: subscriptionRequests, error: subscriptionRequestsError }, { data: completedTrips, error: tripError }] =
      await Promise.all([
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
          .from("driver_wallet_transactions")
          .select("*")
          .eq("driver_id", driverId)
          .order("created_at", { ascending: false })
          .limit(50),
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
          .from("driver_subscription_requests")
          .select("id,plan_type,amount_expected,payment_reference,note,status,created_at,confirmed_at")
          .eq("driver_id", driverId)
          .order("created_at", { ascending: false })
          .limit(10),
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
    if (txError) {
      return NextResponse.json({ ok: false, error: txError.message }, { status: 500 });
    }
    if (settlementsError) {
      return NextResponse.json({ ok: false, error: settlementsError.message }, { status: 500 });
    }
    if (subscriptionPaymentsError) {
      return NextResponse.json({ ok: false, error: subscriptionPaymentsError.message }, { status: 500 });
    }
    if (subscriptionRequestsError) {
      return NextResponse.json({ ok: false, error: subscriptionRequestsError.message }, { status: 500 });
    }
    if (tripError) {
      return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
    }

    const tripIds = (completedTrips ?? []).map((t: any) => t.id);
    const completedAtMap = new Map<string, string>();

    if (tripIds.length > 0) {
      const { data: events } = await supabaseAdmin
        .from("trip_events")
        .select("trip_id,event_type,created_at")
        .in("trip_id", tripIds)
        .eq("event_type", "trip_completed")
        .order("created_at", { ascending: false });

      for (const row of events ?? []) {
        if (!completedAtMap.has((row as any).trip_id)) {
          completedAtMap.set((row as any).trip_id, (row as any).created_at);
        }
      }
    }

    const normalizedTrips = (completedTrips ?? [])
      .map((trip: any) => ({
        ...trip,
        completed_at: completedAtMap.get(trip.id) ?? trip.created_at,
      }))
      .sort(
        (a: any, b: any) =>
          new Date(b.completed_at ?? 0).getTime() - new Date(a.completed_at ?? 0).getTime()
      )
      .slice(0, 50);

    return NextResponse.json({
      ok: true,
      earnings: {
        wallet: wallet ?? null,
        driver: driver ?? null,
        transactions: transactions ?? [],
        settlements: settlements ?? [],
        subscription_payments: subscriptionPayments ?? [],
        subscription_requests: subscriptionRequests ?? [],
        recent_completed_trips: normalizedTrips,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}