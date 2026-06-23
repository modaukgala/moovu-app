import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  isFutureDate,
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

type CorrectionTarget = {
  table: "drivers" | "driver_profiles" | "driver_applications";
  column: string;
  validate?: (value: string) => string | null;
  normalize?: (value: string) => string;
};

const FIELD_MAP: Record<string, CorrectionTarget> = {
  first_name: { table: "drivers", column: "first_name" },
  last_name: { table: "drivers", column: "last_name" },
  phone: {
    table: "drivers",
    column: "phone",
    normalize: normalizeSaPhone,
    validate: (value) => (isValidSaMobile(value) ? null : "Enter a valid South African mobile number."),
  },
  email: {
    table: "drivers",
    column: "email",
    normalize: normalizeDriverEmail,
    validate: (value) => (isValidEmail(value) ? null : "Enter a valid email address."),
  },
  area_name: { table: "driver_profiles", column: "area_name" },
  home_address: { table: "driver_profiles", column: "home_address" },
  emergency_contact_name: { table: "driver_profiles", column: "emergency_contact_name" },
  emergency_contact_phone: {
    table: "driver_profiles",
    column: "emergency_contact_phone",
    normalize: normalizeSaPhone,
    validate: (value) => (isValidSaMobile(value) ? null : "Enter a valid emergency contact number."),
  },
  id_number: {
    table: "driver_profiles",
    column: "id_number",
    validate: (value) => (isValidSaIdNumber(value) ? null : "SA ID number must be exactly 13 digits."),
  },
  license_number: { table: "driver_profiles", column: "license_number" },
  license_code: { table: "driver_profiles", column: "license_code" },
  license_expiry: {
    table: "driver_profiles",
    column: "license_expiry",
    validate: (value) => (isFutureDate(value) ? null : "Licence expiry must be a future date."),
  },
  pdp_number: { table: "driver_profiles", column: "pdp_number" },
  pdp_expiry: {
    table: "driver_profiles",
    column: "pdp_expiry",
    validate: (value) => (isFutureDate(value) ? null : "PDP / PrDP expiry must be a future date."),
  },
  vehicle_make: { table: "drivers", column: "vehicle_make" },
  vehicle_model: { table: "drivers", column: "vehicle_model" },
  vehicle_year: {
    table: "drivers",
    column: "vehicle_year",
    validate: (value) => (isValidVehicleYear(value) ? null : "Vehicle year must be between 1995 and next year."),
  },
  vehicle_color: { table: "drivers", column: "vehicle_color" },
  vehicle_registration: {
    table: "drivers",
    column: "vehicle_registration",
    normalize: normalizeVehicleRegistration,
    validate: (value) => (isValidVehicleRegistration(value) ? null : "Invalid number plate format."),
  },
  vehicle_vin: {
    table: "drivers",
    column: "vehicle_vin",
    normalize: normalizeVin,
    validate: (value) => (isValidVin(value) ? null : "VIN must be exactly 17 characters and cannot contain I, O, or Q."),
  },
  vehicle_engine_number: {
    table: "drivers",
    column: "vehicle_engine_number",
    normalize: normalizeEngineNumber,
    validate: (value) => (isValidEngineNumber(value) ? null : "Engine number must be 6 to 25 uppercase letters/numbers."),
  },
  seating_capacity: {
    table: "drivers",
    column: "seating_capacity",
    validate: (value) => (isValidSeatingCapacity(value) ? null : "Seating capacity must be between 3 and 7."),
  },
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error.";
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin, user } = auth;
    const body = await req.json().catch(() => null);
    const driverId = String(body?.driverId ?? "").trim();
    const fieldName = String(body?.fieldName ?? "").trim();
    const reason = String(body?.reason ?? "").trim();
    const rawValue = String(body?.newValue ?? "").trim();
    const target = FIELD_MAP[fieldName];

    if (!driverId || !fieldName || !target) {
      return NextResponse.json({ ok: false, error: "Driver and editable field are required." }, { status: 400 });
    }

    if (reason.length < 8) {
      return NextResponse.json({ ok: false, error: "Add a clear correction reason before saving." }, { status: 400 });
    }

    const newValue = target.normalize ? target.normalize(rawValue) : rawValue;
    if (!newValue) {
      return NextResponse.json({ ok: false, error: "New value is required." }, { status: 400 });
    }

    const validationError = target.validate?.(newValue);
    if (validationError) {
      return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    }

    const { data: currentRow, error: currentError } = await supabaseAdmin
      .from(target.table)
      .select("*")
      .eq(target.table === "driver_profiles" ? "driver_id" : "id", driverId)
      .maybeSingle();

    if (currentError) {
      return NextResponse.json({ ok: false, error: "Could not load the current driver value." }, { status: 500 });
    }

    const oldValue = currentRow ? String((currentRow as Record<string, unknown>)[target.column] ?? "") : "";

    if (!currentRow && target.table !== "driver_profiles") {
      return NextResponse.json({ ok: false, error: "Driver record not found." }, { status: 404 });
    }

    if (oldValue === newValue) {
      return NextResponse.json({ ok: false, error: "The new value is the same as the current value." }, { status: 400 });
    }

    const { error: auditError } = await supabaseAdmin
      .from("driver_profile_corrections")
      .insert({
        driver_id: driverId,
        application_id: null,
        table_name: target.table,
        field_name: target.column,
        old_value: oldValue || null,
        new_value: newValue,
        correction_reason: reason,
        corrected_by: user.id,
      });

    if (auditError) {
      console.error("[driver-corrections] audit insert failed", {
        driverId,
        fieldName,
        message: auditError.message,
        code: auditError.code,
      });
      return NextResponse.json(
        { ok: false, error: "Correction audit table is not ready. Run the driver admin corrections SQL first." },
        { status: 500 },
      );
    }

    const updatePayload: Record<string, string | number | null> = {
      [target.column]: target.column === "seating_capacity" ? Number(newValue) : newValue,
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = currentRow
      ? await supabaseAdmin
          .from(target.table)
          .update(updatePayload)
          .eq(target.table === "driver_profiles" ? "driver_id" : "id", driverId)
      : await supabaseAdmin
          .from(target.table)
          .insert({
            driver_id: driverId,
            ...updatePayload,
          });

    if (updateError) {
      console.error("[driver-corrections] update failed", {
        driverId,
        fieldName,
        message: updateError.message,
        code: updateError.code,
      });
      return NextResponse.json({ ok: false, error: "Correction was logged but the field could not be updated." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: "Driver correction saved with audit record.",
      fieldName,
      oldValue,
      newValue,
    });
  } catch (error: unknown) {
    console.error("[driver-corrections] unexpected failure", { message: errorMessage(error) });
    return NextResponse.json({ ok: false, error: "Could not save this correction." }, { status: 500 });
  }
}
