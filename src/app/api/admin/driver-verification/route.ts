import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

const ALLOWED = ["pending_review", "approved", "needs_more_info", "rejected"] as const;

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

    if (!ALLOWED.includes(verificationStatus)) {
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

    const { error } = await supabaseAdmin
      .from("drivers")
      .update({
        verification_status: verificationStatus,
        status: driverStatus,
      })
      .eq("id", driverId);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Driver verification updated to ${verificationStatus}`,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}