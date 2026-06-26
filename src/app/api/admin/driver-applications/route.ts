import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  buildDriverReadiness,
  type DriverDocumentStatusInput,
} from "@/lib/driver-validation";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type DriverApplicationRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  profile_completed: boolean | null;
  verification_status: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: string | null;
  vehicle_color: string | null;
  vehicle_registration: string | null;
  vehicle_vin?: string | null;
  vehicle_engine_number?: string | null;
  seating_capacity?: number | null;
  created_at: string | null;
  is_deleted: boolean | null;
};

type DriverProfileLite = {
  driver_id: string;
  id_number: string | null;
  home_address: string | null;
  area_name: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  license_number: string | null;
  license_code: string | null;
  license_expiry: string | null;
  pdp_number: string | null;
  pdp_expiry: string | null;
};

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { supabaseAdmin } = auth;
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "all").trim();

    let query = supabaseAdmin
      .from("drivers")
      .select(`
        id,
        first_name,
        last_name,
        phone,
        email,
        status,
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
        created_at,
        is_deleted
      `)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });

    if (status !== "all") {
      query = query.eq("verification_status", status);
    }

    const { data: applications, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    const rows = (applications ?? []) as DriverApplicationRow[];
    const driverIds = rows.map((row) => row.id);
    const profileByDriver: Record<string, DriverProfileLite> = {};
    const documentsByDriver: Record<string, DriverDocumentStatusInput[]> = {};

    if (driverIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("driver_profiles")
        .select(`
          driver_id,
          id_number,
          home_address,
          area_name,
          emergency_contact_name,
          emergency_contact_phone,
          license_number,
          license_code,
          license_expiry,
          pdp_number,
          pdp_expiry
        `)
        .in("driver_id", driverIds);

      ((profiles ?? []) as DriverProfileLite[]).forEach((profile) => {
        profileByDriver[profile.driver_id] = profile;
      });

      const { data: documents } = await supabaseAdmin
        .from("driver_documents")
        .select("driver_id,doc_type,document_type,status,review_status")
        .in("driver_id", driverIds);

      ((documents ?? []) as (DriverDocumentStatusInput & { driver_id: string })[]).forEach((document) => {
        documentsByDriver[document.driver_id] = documentsByDriver[document.driver_id] ?? [];
        documentsByDriver[document.driver_id].push(document);
      });
    }

    const enriched = rows.map((row) => {
      const profile = profileByDriver[row.id] ?? null;
      const readiness = buildDriverReadiness(
        {
          ...row,
          ...(profile ?? {}),
        },
        documentsByDriver[row.id] ?? [],
        { requirePdp: false },
      );
      const pdp_status = profile?.pdp_number
        ? "uploaded"
        : row.verification_status === "approved"
          ? "not_available_yet"
          : "requested";

      return {
        ...row,
        driver_profile: profile,
        readiness,
        validation_issues: readiness.issues,
        approval_blockers: readiness.blockers,
        readiness_score: readiness.readiness_score,
        pdp_status,
      };
    });

    return NextResponse.json({
      ok: true,
      applications: enriched,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error.") },
      { status: 500 }
    );
  }
}
