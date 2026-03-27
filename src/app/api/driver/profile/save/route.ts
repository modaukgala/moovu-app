import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type SaveBody = {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  id_number?: string | null;
  home_address?: string | null;
  area_name?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  license_number?: string | null;
  license_code?: string | null;
  license_expiry?: string | null;
  pdp_number?: string | null;
  pdp_expiry?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  vehicle_color?: string | null;
  vehicle_registration?: string | null;
  vehicle_vin?: string | null;
  vehicle_engine_number?: string | null;
  seating_capacity?: number | string | null;
  submit?: boolean;
};

function cleanText(value: unknown) {
  const v = String(value ?? "").trim();
  return v.length ? v : null;
}

function cleanDate(value: unknown) {
  const v = String(value ?? "").trim();
  return v.length ? v : null;
}

function cleanNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 401 });
    }

    const body = (await req.json()) as SaveBody;

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
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mappingError) {
      return NextResponse.json({ ok: false, error: mappingError.message }, { status: 500 });
    }

    if (!mapping?.driver_id) {
      return NextResponse.json(
        { ok: false, error: "Your account is not linked to a driver yet." },
        { status: 400 }
      );
    }

    const driverId = mapping.driver_id;
    const submit = !!body.submit;

    const first_name = cleanText(body.first_name);
    const last_name = cleanText(body.last_name);
    const phone = cleanText(body.phone);
    const alt_phone = cleanText(body.alt_phone);
    const id_number = cleanText(body.id_number);
    const home_address = cleanText(body.home_address);
    const area_name = cleanText(body.area_name);
    const emergency_contact_name = cleanText(body.emergency_contact_name);
    const emergency_contact_phone = cleanText(body.emergency_contact_phone);
    const license_number = cleanText(body.license_number);
    const license_code = cleanText(body.license_code);
    const license_expiry = cleanDate(body.license_expiry);
    const pdp_number = cleanText(body.pdp_number);
    const pdp_expiry = cleanDate(body.pdp_expiry);

    const vehicle_make = cleanText(body.vehicle_make);
    const vehicle_model = cleanText(body.vehicle_model);
    const vehicle_year = cleanText(body.vehicle_year);
    const vehicle_color = cleanText(body.vehicle_color);
    const vehicle_registration = cleanText(body.vehicle_registration);
    const vehicle_vin = cleanText(body.vehicle_vin);
    const vehicle_engine_number = cleanText(body.vehicle_engine_number);
    const seating_capacity = cleanNumber(body.seating_capacity);

    if (submit) {
      const missingRequired = [
        !first_name && "first name",
        !last_name && "last name",
        !phone && "phone",
        !id_number && "ID number",
        !home_address && "home address",
        !area_name && "area / township",
        !emergency_contact_name && "emergency contact name",
        !emergency_contact_phone && "emergency contact phone",
        !license_number && "license number",
        !license_code && "license code",
        !license_expiry && "license expiry",
        !vehicle_make && "vehicle make",
        !vehicle_model && "vehicle model",
        !vehicle_year && "vehicle year",
        !vehicle_color && "vehicle color",
        !vehicle_registration && "vehicle registration",
      ].filter(Boolean) as string[];

      if (missingRequired.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: `Please complete all required fields before submitting. Missing: ${missingRequired.join(", ")}.`,
          },
          { status: 400 }
        );
      }
    }

    const nowIso = new Date().toISOString();

    const { error: profileError } = await supabaseAdmin
      .from("driver_profiles")
      .upsert(
        {
          driver_id: driverId,
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
          profile_completed: submit ? true : false,
          submitted_at: submit ? nowIso : null,
          updated_at: nowIso,
        },
        { onConflict: "driver_id" }
      );

    if (profileError) {
      return NextResponse.json({ ok: false, error: profileError.message }, { status: 500 });
    }

    const { error: driverError } = await supabaseAdmin
      .from("drivers")
      .update({
        first_name,
        last_name,
        phone,
        vehicle_make,
        vehicle_model,
        vehicle_year,
        vehicle_color,
        vehicle_registration,
        vehicle_vin,
        vehicle_engine_number,
        seating_capacity,
        profile_completed: submit ? true : false,
        verification_status: submit ? "pending_review" : "draft",
        updated_at: nowIso,
      })
      .eq("id", driverId);

    if (driverError) {
      return NextResponse.json({ ok: false, error: driverError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: submit ? "Profile submitted successfully." : "Draft saved successfully.",
      driverId,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}