import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { loadApplicationAuthority } from "@/lib/admin/applicationAuthority";
import { applicationSummary } from "@/lib/admin/applicationSummary";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const onlineOnly = new URL(req.url).searchParams.get("online") === "true";
    let driverQuery = auth.supabaseAdmin
      .from("drivers")
      .select("id,first_name,last_name,phone,email,status,verification_status,online,busy,created_at")
      .order("created_at", { ascending: false });
    if (onlineOnly) driverQuery = driverQuery.eq("online", true);
    const { data, error } = await driverQuery;

    if (error) {
      console.error("[admin-drivers-list] failed to load drivers", error);
      return NextResponse.json(
        { ok: false, error: "Could not load drivers. Please refresh or contact admin support." },
        { status: 500 }
      );
    }

    try {
      if (!isFinancialAdminRole(auth.profile.role)) throw new Error("Application summaries require review access.");
      const authority = await loadApplicationAuthority(auth.supabaseAdmin, (data ?? []).map((driver) => driver.id));
      return NextResponse.json({
        ok: true,
        application_summaries_available: true,
        drivers: (data ?? []).map((driver) => {
          const phase6 = authority.current.get(driver.id) ?? null;
          return {
            ...driver,
            application_summary: applicationSummary({
              driverId: driver.id,
              verificationStatus: driver.verification_status,
              phase6,
              decision: phase6 ? authority.decisions.get(phase6.id) ?? null : null,
            }),
          };
        }),
      });
    } catch (summaryError) {
      console.error("[admin-drivers-list] application summary unavailable", summaryError);
      return NextResponse.json({
        ok: true,
        application_summaries_available: false,
        application_summary_error: "Application records are unavailable.",
        drivers: (data ?? []).map((driver) => ({ ...driver, application_summary: null })),
      });
    }
  } catch (error: unknown) {
    console.error("[admin-drivers-list] unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not load drivers. Please refresh or contact admin support." },
      { status: 500 }
    );
  }
}
