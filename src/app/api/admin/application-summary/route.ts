import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { loadAdminReviewMetric } from "@/lib/admin/applicationAuthority";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Review access required." }, { status: 403 });
  try {
    const [review, legacy] = await Promise.all([
      loadAdminReviewMetric(),
      auth.supabaseAdmin.from("drivers").select("id", { count: "exact", head: true })
        .eq("is_deleted", false).eq("verification_status", "pending_review"),
    ]);
    return NextResponse.json({ ok: true, needsReview: review, legacyPendingReview: {
      source: "drivers.verification_status", scope: "legacy_driver_verification",
      count: legacy.error ? null : legacy.count, asOf: review.asOf, href: "/admin/applications",
    } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Application summary unavailable." }, { status: 503 });
  }
}
