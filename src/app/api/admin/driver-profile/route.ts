import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;
    const driverId = req.nextUrl.searchParams.get("driverId");

    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Missing driverId" }, { status: 400 });
    }

    const [{ data: driver, error: driverErr }, { data: profile, error: profileErr }, { data: subscriptionPayments, error: subscriptionErr }, { data: subscriptionRequests, error: requestsErr }] =
      await Promise.all([
        supabaseAdmin
          .from("drivers")
          .select(`
            id,
            first_name,
            last_name,
            phone,
            email,
            status,
            online,
            busy,
            profile_completed,
            verification_status,
            vehicle_make,
            vehicle_model,
            vehicle_year,
            vehicle_color,
            vehicle_registration,
            vehicle_vin,
            vehicle_engine_number,
            seating_capacity,
            subscription_status,
            subscription_plan,
            subscription_expires_at,
            subscription_amount_due,
            subscription_last_paid_at,
            subscription_last_payment_amount,
            created_at,
            is_deleted,
            deleted_at,
            delete_mode,
            deleted_reason,
            last_seen
          `)
          .eq("id", driverId)
          .maybeSingle(),
        supabaseAdmin
          .from("driver_profiles")
          .select(`
            driver_id,
            first_name,
            last_name,
            phone,
            alt_phone,
            id_number,
            home_address,
            area_name,
            emergency_contact_name,
            emergency_contact_phone,
            license_number,
            license_code,
            license_expiry,
            pdp_number,
            pdp_expiry,
            profile_completed,
            submitted_at,
            updated_at,
            deleted_at
          `)
          .eq("driver_id", driverId)
          .maybeSingle(),
        supabaseAdmin
          .from("driver_subscription_payments")
          .select(`
            id,
            amount_paid,
            payment_method,
            reference,
            note,
            created_at
          `)
          .eq("driver_id", driverId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabaseAdmin
          .from("driver_subscription_requests")
          .select(`
            id,
            plan_type,
            amount_expected,
            payment_reference,
            note,
            status,
            created_at,
            confirmed_at
          `)
          .eq("driver_id", driverId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

    if (driverErr) {
      return NextResponse.json({ ok: false, error: driverErr.message }, { status: 500 });
    }

    if (profileErr) {
      return NextResponse.json({ ok: false, error: profileErr.message }, { status: 500 });
    }

    if (subscriptionErr) {
      return NextResponse.json({ ok: false, error: subscriptionErr.message }, { status: 500 });
    }

    if (requestsErr) {
      return NextResponse.json({ ok: false, error: requestsErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      profile: {
        ...(driver ?? {}),
        driver_profile: profile ?? null,
      },
      subscription_payments: subscriptionPayments ?? [],
      subscription_requests: subscriptionRequests ?? [],
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
