import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notifyAdmins } from "@/lib/push-notify";
import {
  isValidEmail,
  isValidEngineNumber,
  isValidSaIdNumber,
  isValidSaMobile,
  isValidSeatingCapacity,
  isValidVehicleRegistration,
  isValidVehicleYear,
  isValidVin,
  normalizeDriverEmail,
  normalizeEngineNumber,
  normalizeSaPhone,
  normalizeVehicleRegistration,
  normalizeVin,
} from "@/lib/driver-validation";

type ExistingDriverRow = {
  id: string;
  is_deleted: boolean | null;
  status?: string | null;
  verification_status?: string | null;
  profile_completed?: boolean | null;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error";
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const userId = String(body.userId ?? body.userid ?? "").trim();
    const rawFullName = body.fullName ? String(body.fullName).trim() : "";
    const phone = body.phone ? normalizeSaPhone(body.phone) : null;
    const email = body.email ? normalizeDriverEmail(body.email) : null;
    const notes = body.notes ? String(body.notes).trim() : null;
    const applicationData = body.applicationData && typeof body.applicationData === "object" ? body.applicationData : null;
    const eligibility = applicationData?.eligibility ?? {};
    const personal = applicationData?.personal ?? {};
    const vehicle = applicationData?.vehicle ?? {};
    const pdpStatus = String(body.pdpStatus ?? eligibility.pdpStatus ?? "not_available_yet");

    if (!userId || !email) {
      return NextResponse.json(
        { ok: false, error: "Missing userId/email" },
        { status: 400 }
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
    }

    if (!isValidSaMobile(phone)) {
      return NextResponse.json({ ok: false, error: "Enter a valid South African cellphone number." }, { status: 400 });
    }

    if (personal.idNumber && !isValidSaIdNumber(personal.idNumber)) {
      return NextResponse.json({ ok: false, error: "SA ID number must be exactly 13 digits." }, { status: 400 });
    }

    if (vehicle.year && !isValidVehicleYear(vehicle.year)) {
      return NextResponse.json({ ok: false, error: "Vehicle year must be between 1995 and next year." }, { status: 400 });
    }

    if (vehicle.plate && !isValidVehicleRegistration(vehicle.plate)) {
      return NextResponse.json({ ok: false, error: "Number plate must be 3 to 15 letters/numbers, spaces, or hyphens." }, { status: 400 });
    }

    if (vehicle.vin && !isValidVin(vehicle.vin)) {
      return NextResponse.json({ ok: false, error: "VIN must be exactly 17 characters and cannot contain I, O, or Q." }, { status: 400 });
    }

    if (vehicle.engineNumber && !isValidEngineNumber(vehicle.engineNumber)) {
      return NextResponse.json({ ok: false, error: "Engine number must be 6 to 25 uppercase letters/numbers." }, { status: 400 });
    }

    if (vehicle.seatingCapacity && !isValidSeatingCapacity(vehicle.seatingCapacity)) {
      return NextResponse.json({ ok: false, error: "Seating capacity must be between 3 and 7." }, { status: 400 });
    }

    const fullName = rawFullName || "Unnamed Driver";
    const parts = fullName.split(/\s+/).filter(Boolean);
    const firstName = parts.length > 0 ? parts[0] : "Unnamed";
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "Driver";

    let existingDriver: ExistingDriverRow | null = null;

    const { data: driverByEmail } = await supabaseAdmin
      .from("drivers")
      .select("id, is_deleted, status, verification_status, profile_completed")
      .eq("email", email)
      .limit(1)
      .maybeSingle();

    if (driverByEmail) {
      existingDriver = driverByEmail as ExistingDriverRow;
    } else if (phone) {
      const { data: driverByPhone } = await supabaseAdmin
        .from("drivers")
        .select("id, is_deleted, status, verification_status, profile_completed")
        .eq("phone", phone)
        .limit(1)
        .maybeSingle();

      if (driverByPhone) {
        existingDriver = driverByPhone as ExistingDriverRow;
      }
    }

    let driverId = existingDriver?.id ?? null;
    const preserveApproved = existingDriver?.verification_status === "approved";
    const nextVerificationStatus = preserveApproved
      ? "approved"
      : existingDriver?.verification_status || "pending_review";
    const nextStatus = preserveApproved
      ? existingDriver?.status || "active"
      : "pending";
    const nextProfileCompleted = preserveApproved
      ? Boolean(existingDriver?.profile_completed)
      : false;
    const seatingCapacity = Number(vehicle.seatingCapacity);
    const vehiclePatch = {
      vehicle_make: vehicle.make ? String(vehicle.make).trim() : null,
      vehicle_model: vehicle.model ? String(vehicle.model).trim() : null,
      vehicle_year: vehicle.year ? String(vehicle.year).trim() : null,
      vehicle_color: vehicle.color ? String(vehicle.color).trim() : null,
      vehicle_registration: vehicle.plate ? normalizeVehicleRegistration(vehicle.plate) : null,
      vehicle_vin: vehicle.vin ? normalizeVin(vehicle.vin) : null,
      vehicle_engine_number: vehicle.engineNumber ? normalizeEngineNumber(vehicle.engineNumber) : null,
      seating_capacity: Number.isFinite(seatingCapacity) ? seatingCapacity : null,
    };
    const structuredNotes = [
      notes,
      "MOOVU guided application summary:",
      `Readiness score: ${Number(applicationData?.readinessScore ?? 0)}%`,
      `PDP / PrDP status: ${pdpStatus}`,
      `Valid licence: ${eligibility.validLicence ?? "unknown"}`,
      `Vehicle access: ${eligibility.vehicleAccess ?? "unknown"}`,
      `Operating area: ${eligibility.operatingArea ?? "not captured"}`,
      `Vehicle ownership: ${eligibility.ownershipType ?? vehicle.ownershipType ?? "not captured"}`,
      `Vehicle category: ${vehicle.category ?? "not captured"}`,
    ]
      .filter(Boolean)
      .join("\n");

    if (!driverId) {
      const { data: insertedDriver, error: insertDriverErr } =
        await supabaseAdmin
          .from("drivers")
          .insert({
            first_name: firstName,
            last_name: lastName,
            phone,
            email,
            status: nextStatus,
            verification_status: nextVerificationStatus,
            profile_completed: false,
            online: false,
            busy: false,
            is_deleted: false,
            ...vehiclePatch,
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
          status: nextStatus,
          verification_status: nextVerificationStatus,
          profile_completed: nextProfileCompleted,
          online: false,
          busy: false,
          is_deleted: false,
          deleted_at: null,
          delete_mode: null,
          deleted_reason: null,
          ...vehiclePatch,
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
          id_number: personal.idNumber ? String(personal.idNumber).trim() : null,
          home_address: personal.address ? String(personal.address).trim() : null,
          area_name: eligibility.operatingArea ? String(eligibility.operatingArea).trim() : null,
          emergency_contact_name: personal.emergencyName ? String(personal.emergencyName).trim() : null,
          emergency_contact_phone: personal.emergencyPhone ? String(personal.emergencyPhone).trim() : null,
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
          notes: structuredNotes,
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
          notes: structuredNotes,
          status: "pending",
        });

      if (appInsertErr) {
        return NextResponse.json(
          { ok: false, error: appInsertErr.message },
          { status: 500 }
        );
      }
    }

    await notifyAdmins(
      "New driver application",
      `${fullName} submitted a driver application.`,
      "/admin/applications"
    );

    return NextResponse.json({
      ok: true,
      driverId,
      message: "Application submitted successfully.",
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
