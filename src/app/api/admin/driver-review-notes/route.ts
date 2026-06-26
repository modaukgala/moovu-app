import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin, user } = auth;
    const body = await req.json();
    const driverId = String(body?.driverId ?? "").trim();
    const note = String(body?.note ?? "").trim();
    const noteType = String(body?.noteType ?? "internal").trim() || "internal";

    if (!driverId || note.length < 4) {
      return NextResponse.json({ ok: false, error: "Add a useful note before saving." }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("driver_review_notes").insert({
      driver_id: driverId,
      admin_id: user.id,
      note,
      note_type: noteType,
      created_at: new Date().toISOString(),
    });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: "Driver review note saved." });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
