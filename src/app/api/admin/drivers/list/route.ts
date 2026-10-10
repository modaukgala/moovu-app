import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { loadCurrentPhase6ForDrivers } from "@/lib/admin/applicationAuthority";
import { driverAdminSummary } from "@/lib/admin/applicationSummary";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { data, error } = await auth.supabaseAdmin
      .from("drivers")
      .select("id,first_name,last_name,phone,email,status,verification_status,online,busy,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[admin-drivers-list] failed to load drivers", error);
      return NextResponse.json(
        { ok: false, error: "Could not load drivers. Please refresh or contact admin support." },
        { status: 500 }
      );
    }

    const asOf = new Date().toISOString();
    if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: true, applicationSummariesAvailable: false,
      drivers: (data ?? []).map(driver => ({ ...driver, applicationSummary: null })) },
    { headers: { "Cache-Control": "no-store" } });
    try {
      const related = await loadCurrentPhase6ForDrivers((data ?? []).map(driver => driver.id));
      return NextResponse.json({ ok: true, applicationSummariesAvailable: true, drivers: (data ?? []).map(driver => ({
        ...driver, applicationSummary: driverAdminSummary({ ...driver,
          phase6: related.current.get(driver.id), existingDriver: related.existing.has(driver.id),
        }, asOf),
      })) }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return NextResponse.json({ ok: true, applicationSummariesAvailable: false,
        drivers: (data ?? []).map(driver => ({ ...driver, applicationSummary: null })) },
      { headers: { "Cache-Control": "no-store" } });
    }
  } catch (error: unknown) {
    console.error("[admin-drivers-list] unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not load drivers. Please refresh or contact admin support." },
      { status: 500 }
    );
  }
}
