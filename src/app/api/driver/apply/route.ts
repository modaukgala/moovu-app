import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const userId = String(body.userId ?? body.userid ?? "").trim();
    const rawFullName = body.fullName ? String(body.fullName).trim() : "";
    const phone = body.phone ? String(body.phone).trim() : null;
    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    const notes = body.notes ? String(body.notes).trim() : null;

    if (!userId || !email) {
      return NextResponse.json(
        { ok: false, error: "Missing userId/email" },
        { status: 400 }
      );
    }

    const fullName = rawFullName || "Unnamed Driver";
    const parts = fullName.split(/\s+/).filter(Boolean);
    const firstName = parts.length > 0 ? parts[0] : "Unnamed";
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "Driver";

    let existingDriver: any = null;

    const { data: driverByEmail } = await supabaseAdmin
      .from("drivers")
      .select("id, is_deleted")
      .eq("email", email)
      .limit(1)
      .maybeSingle();

    if (driverByEmail) {
      existingDriver = driverByEmail;
    } else if (phone) {
      const { data: driverByPhone } = await supabaseAdmin
        .from("drivers")
        .select("id, is_deleted")
        .eq("phone", phone)
        .limit(1)
        .maybeSingle();

      if (driverByPhone) {
        existingDriver = driverByPhone;
      }
    }

    let driverId = existingDriver?.id ?? null;

    if (!driverId) {
      const { data: insertedDriver, error: insertDriverErr } =
        await supabaseAdmin
          .from("drivers")
          .insert({
            first_name: firstName,
            last_name: lastName,
            phone,
            email,
            status: "pending",
            verification_status: "pending_review",
            profile_completed: false,
            online: false,
            busy: false,
            is_deleted: false,
          })
          .select("id")
          .single();

      if (insertDriverErr || !insertedDriver) {
        return NextResponse.json(
          {
            ok: false,
            error:
              insertDriverErr?.message || "Failed to create driver row",
          },
          { status: 500 }
        );
      }

      driverId = insertedDriver.id;
    } else {
      const { error: updateDriverErr } = await supabaseAdmin
        .from("drivers")
        .update({
          first_name: firstName,
          last_name: lastName,
          phone,
          email,
          status: "pending",
          verification_status: "pending_review",
          profile_completed: false,
          online: false,
          busy: false,
          is_deleted: false,
          deleted_at: null,
          delete_mode: null,
          deleted_reason: null,
        })
        .eq("id", driverId);

      if (updateDriverErr) {
        return NextResponse.json(
          { ok: false, error: updateDriverErr.message },
          { status: 500 }
        );
      }
    }

    const { error: profileErr } = await supabaseAdmin
      .from("driver_profiles")
      .upsert(
        {
          driver_id: driverId,
          first_name: firstName,
          last_name: lastName,
          phone,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "driver_id" }
      );

    if (profileErr) {
      return NextResponse.json(
        { ok: false, error: profileErr.message },
        { status: 500 }
      );
    }

    const { error: mapErr } = await supabaseAdmin
      .from("driver_accounts")
      .upsert(
        {
          user_id: userId,
          driver_id: driverId,
        },
        { onConflict: "user_id" }
      );

    if (mapErr) {
      return NextResponse.json(
        { ok: false, error: mapErr.message },
        { status: 500 }
      );
    }

    const { data: existingApplication } = await supabaseAdmin
      .from("driver_applications")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (existingApplication?.id) {
      const { error: appUpdateErr } = await supabaseAdmin
        .from("driver_applications")
        .update({
          full_name: fullName,
          phone,
          email,
          notes,
          status: "pending",
        })
        .eq("id", existingApplication.id);

      if (appUpdateErr) {
        return NextResponse.json(
          { ok: false, error: appUpdateErr.message },
          { status: 500 }
        );
      }
    } else {
      const { error: appInsertErr } = await supabaseAdmin
        .from("driver_applications")
        .insert({
          user_id: userId,
          full_name: fullName,
          phone,
          email,
          notes,
          status: "pending",
        });

      if (appInsertErr) {
        return NextResponse.json(
          { ok: false, error: appInsertErr.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      driverId,
      message: "Application submitted successfully.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}