import { NextRequest, NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { loadApplicationAuthority } from "@/lib/admin/applicationAuthority";
import { applicationSummary } from "@/lib/admin/applicationSummary";
import { buildDriverDocumentChecks } from "@/lib/driver-document-checks";
import {
  buildDriverReadiness,
} from "@/lib/driver-validation";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const DRIVER_PROFILE_SELECT = `
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
  vehicle_license_expiry,
  insurance_expiry,
  profile_completed,
  submitted_at,
  updated_at,
  deleted_at
`;

const LEGACY_DRIVER_PROFILE_SELECT = `
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
`;

function isMissingDocumentExpiryColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42703" && (
    message.includes("vehicle_license_expiry") ||
    message.includes("insurance_expiry")
  );
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;
    const financial = isFinancialAdminRole(auth.profile.role);
    const driverId = req.nextUrl.searchParams.get("driverId");

    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Missing driverId" }, { status: 400 });
    }

    const [
      { data: driver, error: driverErr },
      profileResult,
      { data: subscriptionPayments, error: subscriptionErr },
      { data: subscriptionRequests, error: requestsErr },
      { data: documents, error: documentsErr },
    ] = await Promise.all([
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
        .select(DRIVER_PROFILE_SELECT)
        .eq("driver_id", driverId)
        .maybeSingle(),
      financial ? supabaseAdmin
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
        .limit(20) : { data: null, error: null },
      financial ? supabaseAdmin
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
        .limit(20) : { data: null, error: null },
      supabaseAdmin
        .from("driver_documents")
        .select("id,doc_type,document_type,file_path,status,review_status,rejection_reason,uploaded_at,expires_on")
        .eq("driver_id", driverId),
    ]);

    let profile: unknown = profileResult.data;
    let profileErr = profileResult.error;

    if (isMissingDocumentExpiryColumn(profileErr)) {
      const legacyProfileResult = await supabaseAdmin
        .from("driver_profiles")
        .select(LEGACY_DRIVER_PROFILE_SELECT)
        .eq("driver_id", driverId)
        .maybeSingle();
      profile = legacyProfileResult.data;
      profileErr = legacyProfileResult.error;
    }

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

    if (documentsErr) {
      return NextResponse.json({ ok: false, error: documentsErr.message }, { status: 500 });
    }

    const readiness = buildDriverReadiness(
      {
        ...(driver ?? {}),
        ...((profile as Record<string, unknown> | null) ?? {}),
      },
      documents ?? [],
      { requirePdp: false },
    );
    const documentChecks = buildDriverDocumentChecks(
      {
        ...(driver ?? {}),
        ...((profile as Record<string, unknown> | null) ?? {}),
      },
      documents ?? [],
    );

    const { data: corrections, error: correctionsErr } = await supabaseAdmin
      .from("driver_profile_corrections")
      .select("id,table_name,field_name,old_value,new_value,correction_reason,corrected_by,corrected_at")
      .eq("driver_id", driverId)
      .order("corrected_at", { ascending: false })
      .limit(20);

    const { data: reviewNotes, error: reviewNotesErr } = await supabaseAdmin
      .from("driver_review_notes")
      .select("id,note,note_type,admin_id,created_at")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(30);

    let authoritativeApplication = null;
    let applicationReadError: string | null = null;
    try {
      if (!isFinancialAdminRole(auth.profile.role)) throw new Error("Application records require review access.");
      const authority = await loadApplicationAuthority(supabaseAdmin, [driverId]);
      const phase6 = authority.current.get(driverId) ?? null;
      authoritativeApplication = applicationSummary({
        driverId,
        verificationStatus: driver?.verification_status ?? null,
        phase6,
        decision: phase6 ? authority.decisions.get(phase6.id) ?? null : null,
      });
    } catch (error) {
      applicationReadError = error instanceof Error ? error.message : "Application records are unavailable.";
    }

    const accountResult = await supabaseAdmin.from("driver_accounts")
      .select("user_id,driver_id")
      .eq("driver_id", driverId)
      .maybeSingle();
    let linkedAccount: { user_id: string; email: string | null } | null = null;
    let accountReadError: string | null = null;
    if (accountResult.error) {
      accountReadError = "Linked account is unavailable.";
    } else if (accountResult.data?.user_id) {
      const authUser = await supabaseAdmin.auth.admin.getUserById(accountResult.data.user_id);
      if (authUser.error) accountReadError = "Linked login identity is unavailable.";
      else linkedAccount = { user_id: accountResult.data.user_id, email: authUser.data.user?.email ?? null };
    }

    return NextResponse.json({
      ok: true,
      profile: {
        ...(driver ?? {}),
        ...(!financial ? { subscription_amount_due: null, subscription_last_paid_at: null, subscription_last_payment_amount: null } : {}),
        driver_profile: profile ?? null,
      },
      application_summary: authoritativeApplication,
      application_read_error: applicationReadError,
      linked_account: linkedAccount,
      account_read_error: accountReadError,
      subscription_payments: subscriptionPayments ?? [],
      subscription_requests: subscriptionRequests ?? [],
      subscription_financial_access: financial,
      documents: documents ?? [],
      validation_issues: readiness.issues,
      approval_blockers: readiness.blockers,
      readiness,
      readiness_score: readiness.readiness_score,
      document_checks: documentChecks,
      corrections: correctionsErr ? [] : corrections ?? [],
      corrections_ready: !correctionsErr,
      review_notes: reviewNotesErr ? [] : reviewNotes ?? [],
      review_notes_ready: !reviewNotesErr,
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
