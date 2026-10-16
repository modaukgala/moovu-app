import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (auth.profile.role !== "owner")
    return NextResponse.json({ ok: false, error: "Owner access required." }, { status: 403 });

  const { data, error } = await auth.supabaseAdmin.from("moovu_admission_state")
    .select("mode,revision,changed_at,reason").eq("singleton", true).single();
  if (error || !data) return NextResponse.json({ ok: false, error: "Admission state unavailable." }, { status: 503 });
  return NextResponse.json({ ok: true, state: data });
}

export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (auth.profile.role !== "owner")
    return NextResponse.json({ ok: false, error: "Owner access required." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const target = body?.target;
  const reason = body?.reason;
  if ((target !== "NORMAL" && target !== "MAINTENANCE") ||
      typeof reason !== "string" || reason.trim().length < 8 || reason.length > 500) {
    return NextResponse.json({ ok: false, error: "Valid target and reason required." }, { status: 400 });
  }

  const { data, error } = await auth.supabaseAdmin.rpc("moovu_admission_transition", {
    p_target: target, p_actor: auth.user.id, p_reason: reason.trim(),
  });
  if (error) {
    const unbound = error.message.includes("Unbound checkout attempts");
    return NextResponse.json({ ok: false, error: unbound
      ? "Unbound checkout attempts must be reconciled before maintenance can begin."
      : "Admission transition was not completed." }, { status: unbound ? 409 : 503 });
  }
  return NextResponse.json({ ok: true, state: data });
}
