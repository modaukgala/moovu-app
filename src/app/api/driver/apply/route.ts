import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const userId = String(body.userId ?? "").trim();
    const fullName = body.fullName ? String(body.fullName).trim() : null;
    const phone = body.phone ? String(body.phone).trim() : null;
    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    const notes = body.notes ? String(body.notes).trim() : null;

    if (!userId || !email) {
      return NextResponse.json({ ok: false, error: "Missing userId/email" }, { status: 400 });
    }

    // 1) Ensure driver_accounts exists (driver_id can be null until admin links)
    const { error: mapErr } = await supabaseAdmin
      .from("driver_accounts")
      .upsert({ user_id: userId, driver_id: null }, { onConflict: "user_id" });

    if (mapErr) return NextResponse.json({ ok: false, error: mapErr.message }, { status: 500 });

    // 2) Insert application (pending)
    const { error: appErr } = await supabaseAdmin.from("driver_applications").insert({
      user_id: userId,
      full_name: fullName,
      phone,
      email,
      notes,
      status: "pending",
    });

    if (appErr) return NextResponse.json({ ok: false, error: appErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}