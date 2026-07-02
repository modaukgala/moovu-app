import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { buildDriverReadiness } from "@/lib/driver-validation";
import {
  isDriverVerificationAction,
  persistedDriverVerificationStatus,
} from "@/lib/drivers/statusContract";

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;
    const { driverId, verificationStatus } = await req.json();

    if (!driverId || !verificationStatus) {
      return NextResponse.json(
        { ok: false, error: "Missing driverId or verificationStatus" },
        { status: 400 }
      );
    }

    if (!isDriverVerificationAction(verificationStatus)) {
      return NextResponse.json(
        { ok: false, error: "Invalid verificationStatus" },
        { status: 400 }
      );
    }

    const driverStatus =
      verificationStatus === "approved"
        ? "approved"
        : verificationStatus === "rejected"
        ? "rejected"
        : "pending";
    const persistedVerificationStatus = persistedDriverVerificationStatus(verificationStatus);

    const profileCompleted = verificationStatus === "approved";

    if (verificationStatus === "approved") {
      const [{ data: driver, error: driverLoadError }, { data: profile, error: profileLoadError }, { data: documents, error: documentsError }] =
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
              verification_status,
              profile_completed,
              is_deleted,
              vehicle_make,
              vehicle_model,
              vehicle_year,
              vehicle_color,
              vehicle_registration,
              vehicle_vin,
              vehicle_engine_number,
              seating_capacity
            `)
            .eq("id", driverId)
            .maybeSingle(),
          supabaseAdmin
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
            .eq("driver_id", driverId)
            .maybeSingle(),
          supabaseAdmin
            .from("driver_documents")
            .select("doc_type,document_type,status,review_status")
            .eq("driver_id", driverId),
        ]);

      if (driverLoadError || profileLoadError || documentsError) {
        return NextResponse.json(
          { ok: false, error: "Could not validate driver readiness. Please refresh and try again." },
          { status: 500 },
        );
      }

      if (!driver) {
        return NextResponse.json({ ok: false, error: "Driver not found." }, { status: 404 });
      }

      const readiness = buildDriverReadiness(
        {
          ...driver,
          ...(profile ?? {}),
        },
        documents ?? [],
        { requirePdp: false },
      );
      const blockers = readiness.blockers;

      if (blockers.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: `Driver cannot be approved yet: ${blockers[0].message}`,
            validationIssues: readiness.issues,
          },
          { status: 400 },
        );
      }
    }

    const { error: driverError } = await supabaseAdmin
      .from("drivers")
      .update({
        verification_status: persistedVerificationStatus,
        status: driverStatus,
        profile_completed: profileCompleted ? true : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", driverId);

    if (driverError) {
      console.error("[admin-driver-verification] update failed", {
        driverId,
        requestedStatus: verificationStatus,
        persistedStatus: persistedVerificationStatus,
        code: driverError.code,
        reason: driverError.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: driverError.code === "23514"
            ? "This verification action is not supported by the current driver status setup."
            : "Could not update driver verification. Please try again.",
        },
        { status: driverError.code === "23514" ? 400 : 500 },
      );
    }

    if (verificationStatus === "approved") {
      await supabaseAdmin
        .from("driver_profiles")
        .update({
          profile_completed: true,
          updated_at: new Date().toISOString(),
        })
        .eq("driver_id", driverId);
    }

    return NextResponse.json({
      ok: true,
      message: verificationStatus === "needs_more_info"
        ? "More information requested. The driver remains pending review."
        : `Driver verification updated to ${verificationStatus}`,
      verificationStatus: persistedVerificationStatus,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 },
    );
  }
}
