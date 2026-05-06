import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

type RemoveMode = "deactivate" | "permanent";

type DriverAccountRow = {
  user_id: string | null;
};

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { supabaseAdmin } = auth;
    const body = await req.json().catch(() => null);

    const driverId = String(body?.driverId ?? "").trim();
    const mode = String(body?.mode ?? "").trim() as RemoveMode;
    const reason = String(body?.reason ?? "").trim() || null;

    if (!driverId) {
      return NextResponse.json(
        { ok: false, error: "Missing driverId" },
        { status: 400 }
      );
    }

    if (mode !== "deactivate" && mode !== "permanent") {
      return NextResponse.json(
        { ok: false, error: "Invalid remove mode" },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();

    const { data: driver, error: driverErr } = await supabaseAdmin
      .from("drivers")
      .select("id, first_name, last_name, phone, email")
      .eq("id", driverId)
      .maybeSingle();

    if (driverErr) {
      return NextResponse.json(
        { ok: false, error: driverErr.message },
        { status: 500 }
      );
    }

    if (!driver) {
      return NextResponse.json(
        { ok: false, error: "Driver not found" },
        { status: 404 }
      );
    }

    const { data: mappings, error: mapErr } = await supabaseAdmin
      .from("driver_accounts")
      .select("user_id, driver_id")
      .eq("driver_id", driverId);

    if (mapErr) {
      return NextResponse.json(
        { ok: false, error: mapErr.message },
        { status: 500 }
      );
    }

    // Always unlink login(s) first
    const { error: unlinkErr } = await supabaseAdmin
      .from("driver_accounts")
      .delete()
      .eq("driver_id", driverId);

    if (unlinkErr) {
      return NextResponse.json(
        { ok: false, error: unlinkErr.message },
        { status: 500 }
      );
    }

    // Remove push subscriptions tied to unlinked user ids
    const userIds = ((mappings ?? []) as DriverAccountRow[])
      .map((mapping) => mapping.user_id)
      .filter((userId): userId is string => Boolean(userId));
    if (userIds.length > 0) {
      await supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .in("user_id", userIds);
    }

    if (mode === "deactivate") {
      const { error: dErr } = await supabaseAdmin
        .from("drivers")
        .update({
          online: false,
          busy: false,
          status: "inactive",
          verification_status: "deactivated",
          subscription_status: "inactive",
          is_deleted: true,
          deleted_at: nowIso,
          delete_mode: "deactivate",
          deleted_reason: reason,
          updated_at: nowIso,
        })
        .eq("id", driverId);

      if (dErr) {
        return NextResponse.json(
          { ok: false, error: dErr.message },
          { status: 500 }
        );
      }

      await supabaseAdmin
        .from("driver_profiles")
        .update({
          deleted_at: nowIso,
          updated_at: nowIso,
        })
        .eq("driver_id", driverId);

      return NextResponse.json({
        ok: true,
        mode,
        message:
          "Driver deactivated successfully. Trips/history kept. Driver can register again later.",
      });
    }

    // permanent = purge personal/account data but preserve trip records
    const anonymizedName = `Deleted Driver ${driverId.slice(0, 8)}`;

    const { error: purgeDriverErr } = await supabaseAdmin
      .from("drivers")
      .update({
        first_name: anonymizedName,
        last_name: null,
        phone: null,
        email: null,
        online: false,
        busy: false,
        status: "deleted",
        verification_status: "deleted",
        subscription_status: "inactive",
        profile_completed: false,
        vehicle_make: null,
        vehicle_model: null,
        vehicle_year: null,
        vehicle_color: null,
        vehicle_registration: null,
        vehicle_vin: null,
        vehicle_engine_number: null,
        seating_capacity: null,
        lat: null,
        lng: null,
        last_seen: null,
        is_deleted: true,
        deleted_at: nowIso,
        delete_mode: "permanent",
        deleted_reason: reason,
        updated_at: nowIso,
      })
      .eq("id", driverId);

    if (purgeDriverErr) {
      return NextResponse.json(
        { ok: false, error: purgeDriverErr.message },
        { status: 500 }
      );
    }

    // purge driver profile
    await supabaseAdmin
      .from("driver_profiles")
      .update({
        first_name: null,
        last_name: null,
        phone: null,
        alt_phone: null,
        id_number: null,
        home_address: null,
        area_name: null,
        emergency_contact_name: null,
        emergency_contact_phone: null,
        license_number: null,
        license_code: null,
        license_expiry: null,
        pdp_number: null,
        pdp_expiry: null,
        deleted_at: nowIso,
        updated_at: nowIso,
      })
      .eq("driver_id", driverId);

    // remove wallet current balances/transactions if you want "everything except trips"
    await supabaseAdmin.from("driver_wallet_transactions").delete().eq("driver_id", driverId);
    await supabaseAdmin.from("driver_wallets").delete().eq("driver_id", driverId);

    return NextResponse.json({
      ok: true,
      mode,
      message:
        "Driver permanently deleted from active account data. Trip records were preserved.",
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 }
    );
  }
}
