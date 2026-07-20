import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  const tripId = String(id ?? "").trim();
  if (!tripId) {
    return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
  }

  const { data: trip, error } = await auth.supabaseAdmin
    .from("trips")
    .select("id,start_otp,end_otp,start_otp_verified,end_otp_verified")
    .eq("id", tripId)
    .maybeSingle();

  if (error || !trip) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Trip not found." }, { status: error ? 500 : 404 });
  }

  const { error: auditError } = await auth.supabaseAdmin.from("audit_logs").insert({
    actor_id: auth.user.id,
    action: "otp_revealed",
    entity_type: "trip",
    entity_id: tripId,
    detail: { role: auth.profile.role },
  });
  if (auditError) {
    return NextResponse.json({ ok: false, error: "OTP audit storage is not ready. Apply the MOOVU dispatch migration first." }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    startOtp: trip.start_otp,
    endOtp: trip.end_otp,
    startVerified: Boolean(trip.start_otp_verified),
    endVerified: Boolean(trip.end_otp_verified),
  });
}
