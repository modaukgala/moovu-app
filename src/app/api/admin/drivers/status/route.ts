import { NextResponse } from "next/server";
import { requireAdminUser, isFinancialAdminRole } from "@/lib/auth/admin";

const ALLOWED_STATUSES = new Set(["pending", "approved", "active", "inactive", "suspended", "rejected"]);

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }
    if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Authorized reviewer access required." }, { status: 403 });

    const body = await req.json();
    const driverId = String(body?.driverId ?? "").trim();
    const requestedStatus = String(body?.status ?? "").trim();
    const status = requestedStatus === "suspended" ? "inactive" : requestedStatus;

    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Driver ID is required." }, { status: 400 });
    }

    if (!ALLOWED_STATUSES.has(requestedStatus)) {
      return NextResponse.json({ ok: false, error: "Invalid driver status." }, { status: 400 });
    }

    if (!["active", "inactive"].includes(status)) return NextResponse.json({ ok: false, error: "Use versioned onboarding review for approval, rejection and corrections." }, { status: 409 });
    const { error } = await auth.supabaseAdmin.rpc("phase6_operating_status", { p_actor: auth.user.id, p_driver: driverId, p_status: status, p_reason: typeof body.reason === "string" && body.reason.trim().length >= 8 ? body.reason.trim().slice(0, 2000) : "Administrative operating status control" });

    if (error) {
      if (error.code === "23514") {
        return NextResponse.json(
          { ok: false, error: "This driver status is not supported by the current database setup." },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { ok: false, error: "Could not update driver status. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, status });
  } catch (error: unknown) {
    console.error("[admin-driver-status] unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not update driver status. Please try again." },
      { status: 500 }
    );
  }
}
